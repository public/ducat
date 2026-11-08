/**
 * `@ducatjs/money/kysely`: Money columns for Kysely. Declare a column as `MoneyColumn<'EUR'>` in the
 * database type, say how it is stored in a `MoneyPlugin`, and Kysely selects return `Money` while
 * inserts, updates and comparisons take it:
 *
 *     interface Database {
 *       orders: { id: number; total_minor: MoneyColumn<'EUR'>; refund: MoneyColumn | null };
 *     }
 *     const db = new Kysely<Database>({
 *       dialect,
 *       plugins: [
 *         new MoneyPlugin<Database>({
 *           orders: { total_minor: moneyMinor('EUR'), refund: moneyJson() },
 *         }),
 *       ],
 *     });
 *
 * The plugin reads the query tree, so it follows aliases, joins, subqueries, CTEs and `returning`.
 * It imports nothing from kysely at run time.
 */
import type {
  ColumnType,
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RootOperationNode,
  UnknownRow,
} from 'kysely';
import { CurrencyMismatchError, isMoney, type CurrencyInput, type Money } from './money.js';
import {
  checkDecimalSize,
  decimalFromDriver,
  decimalToDriver,
  jsonFromDriver,
  jsonToDriver,
  minorFromDriver,
  minorToDriver,
  type DecimalColumnSize,
} from './sql.js';

/**
 * A column that Kysely selects as `Money<C>` and that inserts and updates take as `Money<C>`. Use
 * `MoneyColumn<'EUR'> | null` for a nullable column, and `MoneyColumn` for one whose currency varies
 * (a JSON column, or minor units next to a currency column).
 */
export type MoneyColumn<C extends string = CurrencyInput> = ColumnType<
  Money<C>,
  Money<C>,
  Money<C>
>;

/** Where a column's currency comes from: fixed, or another column of the same row. */
type CurrencySource<C extends string> = C | { readonly currencyColumn: string };

/** How a money column is stored. Made by `moneyMinor`, `moneyDecimal` and `moneyJson`. */
export interface MoneyColumnSpec<C extends string = string> {
  readonly storage: 'minor' | 'decimal' | 'json';
  /** The fixed currency, if there is one. */
  readonly currency?: C;
  /** The column of the same row that holds the currency code. */
  readonly currencyColumn?: string;
  readonly size?: DecimalColumnSize;
}

function specFor<C extends string>(
  storage: MoneyColumnSpec['storage'],
  source: CurrencySource<C> | undefined,
  size?: DecimalColumnSize,
): MoneyColumnSpec<C> {
  if (source === undefined) {
    return { storage };
  }
  if (typeof source === 'string') {
    return size === undefined ? { storage, currency: source } : { storage, currency: source, size };
  }
  return { storage, currencyColumn: source.currencyColumn };
}

/**
 * A BIGINT (SQLite INTEGER) column of minor units, `1234` for 12.34 EUR, in a fixed currency or with
 * the currency in another column: `moneyMinor('EUR')`, `moneyMinor({ currencyColumn: 'currency' })`.
 * Minor units are sent as integer strings, which every driver binds exactly.
 */
export function moneyMinor<const C extends CurrencyInput>(
  currency: CurrencySource<C>,
): MoneyColumnSpec<C> {
  return specFor('minor', currency);
}

/**
 * A NUMERIC/DECIMAL (SQLite TEXT) column holding the exact decimal, `12.34`. With a fixed currency,
 * pass the column's size to have writes the column would round or clamp throw:
 * `moneyDecimal('EUR', { precision: 19, scale: 4 })`.
 */
export function moneyDecimal<const C extends CurrencyInput>(
  currency: CurrencySource<C>,
  size?: DecimalColumnSize,
): MoneyColumnSpec<C> {
  if (size !== undefined && typeof currency === 'string') {
    checkDecimalSize(currency, size);
  }
  return specFor('decimal', currency, size);
}

/**
 * A JSON, JSONB or TEXT column holding `{"amount":"12.34","currency":"EUR"}`. Pass a currency to fix
 * it: then a value in another currency throws, on write and on read.
 */
export function moneyJson<const C extends CurrencyInput = CurrencyInput>(
  currency?: C,
): MoneyColumnSpec<C> {
  return specFor('json', currency);
}

type MoneySelectType<T> =
  NonNullable<T> extends { readonly __select__: infer S } ? NonNullable<S> : never;

// wrapped in tuples: a bare `never extends Money` would count every non-money column as money
type MoneyColumnNames<Table> = {
  [K in keyof Table]-?: [MoneySelectType<Table[K]>] extends [never]
    ? never
    : [MoneySelectType<Table[K]>] extends [Money<string>]
      ? K
      : never;
}[keyof Table];

/** A fixed-currency column must be configured in its own currency; any column may use a column. */
type SpecForColumn<T> =
  MoneySelectType<T> extends Money<infer C>
    ? string extends C
      ? MoneyColumnSpec<string>
      : MoneyColumnSpec<C>
    : never;

type TablesWithMoney<Database> = {
  [T in keyof Database]: [MoneyColumnNames<Database[T]>] extends [never] ? never : T;
}[keyof Database];

/**
 * The plugin's configuration: for every table with `MoneyColumn`s, how each of them is stored. Every
 * money column of the database type must be listed, so a select never claims a `Money` that the
 * plugin would not make.
 */
export type MoneyPluginConfig<Database> = {
  readonly [T in TablesWithMoney<Database>]: {
    readonly [K in MoneyColumnNames<Database[T]>]: SpecForColumn<Database[T][K]>;
  };
};

// The parts of Kysely's operation nodes the plugin reads. Nodes are frozen plain objects, so the
// plugin copies the ones it changes.
interface Node {
  readonly kind: string;
  readonly [field: string]: unknown;
}

/** A table or derived table in scope, by the name queries use for it, with its money columns. */
interface Source {
  readonly name: string;
  readonly columns: ReadonlyMap<string, MoneyColumnSpec>;
}

interface Scope {
  readonly sources: readonly Source[];
  readonly ctes: ReadonlyMap<string, ReadonlyMap<string, MoneyColumnSpec>>;
  readonly parent: Scope | undefined;
}

/** One selected column: where it comes from and the result key it is returned under. */
interface Output {
  readonly key: string;
  readonly source: Source | undefined;
  readonly column: string | undefined;
  readonly spec: MoneyColumnSpec | undefined;
}

/** How to turn one result key into Money: the spec, and the key holding the currency if any. */
interface ResultMapping {
  readonly key: string;
  readonly spec: MoneyColumnSpec;
  readonly currencyKey: string | undefined;
}

const NO_COLUMNS: ReadonlyMap<string, MoneyColumnSpec> = new Map();
const EMPTY_SCOPE: Scope = { sources: [], ctes: new Map(), parent: undefined };

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).kind === 'string';
}

function nodeOfKind(value: unknown, kind: string): Node | undefined {
  return isNode(value) && value.kind === kind ? value : undefined;
}

function identifierName(node: unknown): string | undefined {
  const identifier = nodeOfKind(node, 'IdentifierNode');
  return identifier === undefined ? undefined : (identifier.name as string);
}

function columnName(node: unknown): string | undefined {
  const column = nodeOfKind(node, 'ColumnNode');
  return column === undefined ? undefined : identifierName(column.column);
}

function tableNames(node: unknown): { name: string; qualified: string } | undefined {
  const table = nodeOfKind(node, 'TableNode');
  if (table === undefined) {
    return undefined;
  }
  const schemable = table.table as Node;
  const name = identifierName(schemable.identifier)!;
  const schema = identifierName(schemable.schema);
  return { name, qualified: schema === undefined ? name : `${schema}.${name}` };
}

function storeFor(spec: MoneyColumnSpec, money: Money): string {
  if (spec.storage === 'minor') {
    return minorToDriver(money, spec.currency).toString();
  }
  if (spec.storage === 'decimal') {
    return decimalToDriver(money, spec.currency, spec.size);
  }
  return jsonToDriver(money, spec.currency);
}

function readFor(spec: MoneyColumnSpec, value: unknown, currency: string): Money {
  if (spec.storage === 'minor') {
    return minorFromDriver(value, currency);
  }
  if (spec.storage === 'decimal') {
    return decimalFromDriver(value, currency);
  }
  return jsonFromDriver(value, spec.currency);
}

function unknownMoneyError(): TypeError {
  return new TypeError(
    'A Money value is bound where no money column says how to store it; ' +
      'compare or assign it to a configured column, or pass toDecimal(m) or toMinor(m) yourself',
  );
}

/** The plugin's per-query work: rewriting the query tree and working out the result mapping. */
class QueryRewriter {
  readonly #config: Readonly<Record<string, Readonly<Record<string, MoneyColumnSpec>>>>;

  constructor(config: Readonly<Record<string, Readonly<Record<string, MoneyColumnSpec>>>>) {
    this.#config = config;
  }

  /** The money columns of a FROM item: a table, an aliased table, or an aliased subquery. */
  sourceFor(item: unknown, scope: Scope): Source | undefined {
    const alias = nodeOfKind(item, 'AliasNode');
    const target = alias === undefined ? item : alias.node;
    const aliasName = alias === undefined ? undefined : identifierName(alias.alias);

    const table = tableNames(target);
    if (table !== undefined) {
      const columns = this.#tableColumns(table.qualified, table.name, scope);
      return { name: aliasName ?? table.name, columns };
    }
    if (aliasName !== undefined && isNode(target) && target.kind === 'SelectQueryNode') {
      const inner = this.#scopeFor(target, scope);
      return { name: aliasName, columns: this.#derivedColumns(this.outputsOf(target, inner)) };
    }
    return undefined;
  }

  #tableColumns(
    qualified: string,
    name: string,
    scope: Scope,
  ): ReadonlyMap<string, MoneyColumnSpec> {
    for (let current: Scope | undefined = scope; current !== undefined; current = current.parent) {
      const cte = current.ctes.get(name);
      if (cte !== undefined) {
        return cte;
      }
    }
    const configured = this.#config[qualified] ?? this.#config[name];
    return configured === undefined ? NO_COLUMNS : new Map(Object.entries(configured));
  }

  /** A subquery's or CTE's money columns, by output name, with currency columns renamed to match. */
  #derivedColumns(outputs: readonly Output[]): ReadonlyMap<string, MoneyColumnSpec> {
    const columns = new Map<string, MoneyColumnSpec>();
    for (const mapping of this.#mappingsFor(outputs)) {
      if (mapping.currencyKey === undefined) {
        columns.set(mapping.key, mapping.spec);
      } else {
        columns.set(mapping.key, { ...mapping.spec, currencyColumn: mapping.currencyKey });
      }
    }
    return columns;
  }

  #scopeFor(query: Node, parent: Scope): Scope {
    const ctes = new Map<string, ReadonlyMap<string, MoneyColumnSpec>>();
    const withNode = nodeOfKind(query.with, 'WithNode');
    let scope: Scope = { sources: [], ctes, parent };

    for (const expression of (withNode?.expressions ?? []) as Node[]) {
      const nameNode = expression.name as Node;
      const name = tableNames(nameNode.table)!.name;
      const body = expression.expression;
      // a CTE with its own column list renames the outputs, so only plain CTEs carry money columns
      if (nameNode.columns === undefined && isNode(body) && body.kind === 'SelectQueryNode') {
        ctes.set(name, this.#derivedColumns(this.outputsOf(body, this.#scopeFor(body, scope))));
      }
      scope = { sources: [], ctes, parent };
    }

    const items: unknown[] = [];
    if (query.kind === 'InsertQueryNode') {
      items.push(query.into);
    }
    if (query.kind === 'UpdateQueryNode') {
      items.push(query.table);
    }
    const from = nodeOfKind(query.from, 'FromNode');
    items.push(...((from?.froms ?? []) as unknown[]));
    const using = nodeOfKind(query.using, 'UsingNode');
    items.push(...((using?.tables ?? []) as unknown[]));
    for (const join of (query.joins ?? []) as Node[]) {
      items.push(join.table);
    }

    const sources: Source[] = [];
    for (const item of items) {
      const source = this.sourceFor(item, scope);
      if (source !== undefined) {
        sources.push(source);
      }
    }
    return { sources, ctes, parent };
  }

  /** The source and spec of a column reference, searching outwards for correlated subqueries. */
  #resolve(
    reference: unknown,
    scope: Scope,
  ): { source: Source | undefined; column: string; spec: MoneyColumnSpec | undefined } | undefined {
    let column = columnName(reference);
    let tableName: string | undefined;
    const referenceNode = nodeOfKind(reference, 'ReferenceNode');
    if (referenceNode !== undefined) {
      column = columnName(referenceNode.column);
      tableName = tableNames(referenceNode.table)?.name;
    }
    if (column === undefined) {
      return undefined;
    }

    for (let current: Scope | undefined = scope; current !== undefined; current = current.parent) {
      if (tableName !== undefined) {
        const source = current.sources.find((candidate) => candidate.name === tableName);
        if (source !== undefined) {
          return { source, column, spec: source.columns.get(column) };
        }
        continue;
      }
      const candidates = current.sources.filter((candidate) => candidate.columns.has(column));
      if (candidates.length > 1) {
        throw new TypeError(
          `Column "${column}" is a money column of more than one table here; qualify it`,
        );
      }
      if (candidates.length === 1) {
        const source = candidates[0]!;
        return { source, column, spec: source.columns.get(column) };
      }
      if (current.sources.length === 1) {
        return { source: current.sources[0], column, spec: undefined };
      }
    }
    return { source: undefined, column, spec: undefined };
  }

  /** What a select (or `returning`) returns, column by column. */
  outputsOf(query: Node, scope: Scope): Output[] {
    const selectionsHolder =
      query.kind === 'SelectQueryNode' ? query : nodeOfKind(query.returning, 'ReturningNode');
    const selections = (selectionsHolder?.selections ?? []) as Node[];
    const outputs: Output[] = [];

    for (const selectionNode of selections) {
      const selection = selectionNode.selection;
      const alias = nodeOfKind(selection, 'AliasNode');
      const target = alias === undefined ? selection : alias.node;
      const referenceNode = nodeOfKind(target, 'ReferenceNode');

      // `select *` and `select t.*`: every money column of the sources in question
      const isSelectAll =
        nodeOfKind(target, 'SelectAllNode') !== undefined ||
        nodeOfKind(referenceNode?.column, 'SelectAllNode') !== undefined;
      if (isSelectAll) {
        const tableName = tableNames(referenceNode?.table)?.name;
        const sources = scope.sources.filter(
          (source) => tableName === undefined || source.name === tableName,
        );
        for (const source of sources) {
          for (const [column, spec] of source.columns) {
            outputs.push({ key: column, source, column, spec });
            if (spec.currencyColumn !== undefined) {
              outputs.push({
                key: spec.currencyColumn,
                source,
                column: spec.currencyColumn,
                spec: undefined,
              });
            }
          }
        }
        continue;
      }

      // a scalar subquery returning one fixed-currency money column maps like the column itself
      const subquery = nodeOfKind(target, 'SelectQueryNode');
      if (subquery !== undefined && alias !== undefined) {
        const inner = this.outputsOf(subquery, this.#scopeFor(subquery, scope));
        const spec = inner.length === 1 ? inner[0]!.spec : undefined;
        if (spec !== undefined && spec.currencyColumn === undefined) {
          outputs.push({
            key: identifierName(alias.alias)!,
            source: undefined,
            column: undefined,
            spec,
          });
          continue;
        }
      }
      this.#rejectNestedMoney(target, scope);

      const resolved = this.#resolve(target, scope);
      const key = alias === undefined ? resolved?.column : identifierName(alias.alias);
      if (key !== undefined) {
        outputs.push({
          key,
          source: resolved?.source,
          column: resolved?.column,
          spec: resolved?.spec,
        });
      }
    }
    return outputs;
  }

  /**
   * Throws if a selection expression contains a subquery that selects a money column, as
   * `jsonArrayFrom` does: its rows come back as JSON, which the plugin can't map, while Kysely
   * would type them as Money.
   */
  #rejectNestedMoney(expression: unknown, scope: Scope): void {
    if (Array.isArray(expression)) {
      for (const item of expression) {
        this.#rejectNestedMoney(item, scope);
      }
      return;
    }
    if (!isNode(expression)) {
      return;
    }
    if (expression.kind === 'SelectQueryNode') {
      const inner = this.outputsOf(expression, this.#scopeFor(expression, scope));
      const money = inner.find((output) => output.spec !== undefined);
      if (money !== undefined) {
        throw new TypeError(
          `The money column "${money.column}" is selected inside a subquery in the select list, ` +
            'whose rows the plugin cannot map; select it at the top level, or use a join',
        );
      }
      return;
    }
    for (const [field, child] of Object.entries(expression)) {
      if (field !== 'kind') {
        this.#rejectNestedMoney(child, scope);
      }
    }
  }

  #mappingsFor(outputs: readonly Output[]): ResultMapping[] {
    const mappings: ResultMapping[] = [];
    for (const output of outputs) {
      if (output.spec === undefined) {
        continue;
      }
      const currencyColumn = output.spec.currencyColumn;
      if (currencyColumn === undefined) {
        mappings.push({ key: output.key, spec: output.spec, currencyKey: undefined });
        continue;
      }
      const currencyOutput = outputs.find(
        (candidate) => candidate.source === output.source && candidate.column === currencyColumn,
      );
      if (currencyOutput === undefined) {
        throw new TypeError(
          `Selecting the money column "${output.column}" needs its currency column ` +
            `"${currencyColumn}" in the same select`,
        );
      }
      mappings.push({ key: output.key, spec: output.spec, currencyKey: currencyOutput.key });
    }
    return mappings;
  }

  /** The rewritten root node, and how to map its rows. */
  rewriteRoot(node: RootOperationNode): { node: RootOperationNode; mappings: ResultMapping[] } {
    const root = node as unknown as Node;
    const isQuery =
      root.kind === 'SelectQueryNode' ||
      root.kind === 'InsertQueryNode' ||
      root.kind === 'UpdateQueryNode' ||
      root.kind === 'DeleteQueryNode';
    if (!isQuery) {
      return { node: this.#rewrite(root, EMPTY_SCOPE) as RootOperationNode, mappings: [] };
    }
    const scope = this.#scopeFor(root, EMPTY_SCOPE);
    const mappings = this.#mappingsFor(this.outputsOf(root, scope));
    return { node: this.#rewrite(root, EMPTY_SCOPE) as RootOperationNode, mappings };
  }

  /** Copies the tree, storing Money values for the columns they are bound to. */
  #rewrite(value: unknown, scope: Scope): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.#rewrite(item, scope));
    }
    if (!isNode(value)) {
      return value;
    }

    if (value.kind === 'ValueNode') {
      if (isMoney(value.value)) {
        throw unknownMoneyError();
      }
      return value;
    }
    if (value.kind === 'PrimitiveValueListNode') {
      if ((value.values as unknown[]).some(isMoney)) {
        throw unknownMoneyError();
      }
      return value;
    }

    let node = value;
    let innerScope = scope;
    const isQuery =
      node.kind === 'SelectQueryNode' ||
      node.kind === 'InsertQueryNode' ||
      node.kind === 'UpdateQueryNode' ||
      node.kind === 'DeleteQueryNode';
    if (isQuery) {
      innerScope = this.#scopeFor(node, scope);
    }
    if (node.kind === 'InsertQueryNode') {
      node = this.#rewriteInsert(node, innerScope);
    }
    if (node.kind === 'ColumnUpdateNode') {
      node = this.#rewriteColumnUpdate(node, innerScope);
    }
    if (node.kind === 'BinaryOperationNode') {
      node = this.#rewriteComparison(node, innerScope);
    }

    const copy: Record<string, unknown> = { kind: node.kind };
    for (const [field, child] of Object.entries(node)) {
      if (field !== 'kind') {
        copy[field] = this.#rewrite(child, innerScope);
      }
    }
    return Object.freeze(copy);
  }

  /** Stores the operand on the other side of a comparison with a money column. */
  #rewriteComparison(node: Node, scope: Scope): Node {
    const leftSpec = this.#resolve(node.leftOperand, scope)?.spec;
    const rightSpec = this.#resolve(node.rightOperand, scope)?.spec;
    if (leftSpec !== undefined) {
      return { ...node, rightOperand: this.#store(node.rightOperand, leftSpec) };
    }
    if (rightSpec !== undefined) {
      return { ...node, leftOperand: this.#store(node.leftOperand, rightSpec) };
    }
    return node;
  }

  /** A Money value node (or a list of them, for `in`) as the column stores it. */
  #store(operand: unknown, spec: MoneyColumnSpec): unknown {
    const valueNode = nodeOfKind(operand, 'ValueNode');
    if (valueNode !== undefined && isMoney(valueNode.value)) {
      return { ...valueNode, value: storeFor(spec, valueNode.value) };
    }
    const primitiveList = nodeOfKind(operand, 'PrimitiveValueListNode');
    if (primitiveList !== undefined) {
      const values = (primitiveList.values as unknown[]).map((item) =>
        isMoney(item) ? storeFor(spec, item) : item,
      );
      return { ...primitiveList, values };
    }
    const valueList = nodeOfKind(operand, 'ValueListNode');
    if (valueList !== undefined) {
      const values = (valueList.values as unknown[]).map((item) => this.#store(item, spec));
      return { ...valueList, values };
    }
    return operand;
  }

  #rewriteColumnUpdate(node: Node, scope: Scope): Node {
    const spec = this.#resolve(node.column, scope)?.spec;
    return spec === undefined ? node : { ...node, value: this.#store(node.value, spec) };
  }

  #rewriteInsert(node: Node, scope: Scope): Node {
    const values = nodeOfKind(node.values, 'ValuesNode');
    const target = scope.sources[0];
    if (values === undefined || target === undefined) {
      return node;
    }
    const columns = ((node.columns ?? []) as Node[]).map((column) => columnName(column)!);
    const specs = columns.map((column) => target.columns.get(column));

    const rows = (values.values as Node[]).map((row) => {
      const isPrimitive = row.kind === 'PrimitiveValueListNode';
      const items = row.values as unknown[];
      const stored = items.map((item, index) => {
        const spec = specs[index];
        if (spec === undefined) {
          return item;
        }
        const money = isPrimitive ? item : nodeOfKind(item, 'ValueNode')?.value;
        if (isMoney(money) && spec.currencyColumn !== undefined) {
          this.#checkRowCurrency(money, spec.currencyColumn, columns, items, isPrimitive);
        }
        if (isPrimitive) {
          return isMoney(item) ? storeFor(spec, item) : item;
        }
        return this.#store(item, spec);
      });
      return { ...row, values: stored };
    });
    return { ...node, values: { ...values, values: rows } };
  }

  /** In an insert, the currency column's value must be the Money's currency. */
  #checkRowCurrency(
    money: Money,
    currencyColumn: string,
    columns: readonly string[],
    items: readonly unknown[],
    isPrimitive: boolean,
  ): void {
    const index = columns.indexOf(currencyColumn);
    if (index < 0) {
      return;
    }
    const item = items[index];
    const currency = isPrimitive ? item : nodeOfKind(item, 'ValueNode')?.value;
    if (typeof currency === 'string' && currency !== money.currency) {
      throw new CurrencyMismatchError(currency, money.currency);
    }
  }
}

/**
 * A Kysely plugin that returns `Money` for the configured columns and stores `Money` parameters the
 * way each column needs. The configuration is checked against the database type: every
 * `MoneyColumn` needs an entry, and a fixed-currency column's spec must be in that currency.
 *
 * A Money value bound anywhere the plugin can't tie to a money column (inside a function call, for
 * example) throws rather than reaching the driver as an object.
 */
export class MoneyPlugin<
  Database = Record<string, Record<string, unknown>>,
> implements KyselyPlugin {
  readonly #rewriter: QueryRewriter;
  readonly #mappings = new WeakMap<object, ResultMapping[]>();

  constructor(config: MoneyPluginConfig<Database>) {
    this.#rewriter = new QueryRewriter(
      config as Readonly<Record<string, Readonly<Record<string, MoneyColumnSpec>>>>,
    );
  }

  /** Rewrites Money parameters and records which result columns to turn into Money. */
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    const { node, mappings } = this.#rewriter.rewriteRoot(args.node);
    if (mappings.length > 0) {
      this.#mappings.set(args.queryId, mappings);
    }
    return node;
  }

  /** Turns the recorded columns of every row into Money. */
  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    const mappings = this.#mappings.get(args.queryId);
    if (mappings === undefined) {
      return args.result;
    }
    this.#mappings.delete(args.queryId);

    const rows = args.result.rows.map((row) => {
      const mapped: UnknownRow = Object.assign({}, row);
      for (const mapping of mappings) {
        const value = row[mapping.key];
        if (value === null || value === undefined) {
          continue;
        }
        let currency = mapping.spec.currency ?? '';
        if (mapping.currencyKey !== undefined) {
          const currencyValue = row[mapping.currencyKey];
          if (typeof currencyValue !== 'string') {
            throw new TypeError(`Expected a currency code in "${mapping.currencyKey}"`);
          }
          currency = currencyValue;
        }
        mapped[mapping.key] = readFor(mapping.spec, value, currency);
      }
      return mapped;
    });
    return { ...args.result, rows };
  }
}
