// `@ducatjs/money/finance`, as published: registers every ISO 4217 code first, as every entry
// except /fn does, then the module itself.
import '../plugins/iso.js';
import {
  irr as excelIrr,
  npv as excelNpv,
  npvExact as excelNpvExact,
  type IrrOptions as ExcelIrrOptions,
  type IrrResult as ExcelIrrResult,
} from '../excel.js';

export * from '../finance.js';

// Excel's functions moved to `@ducatjs/money/excel` in 0.4. These re-export them from here for
// 0.4 only, so imports from 0.3 keep working; they are removed in 0.5.

/** @deprecated Excel's NPV moved to `@ducatjs/money/excel`; this re-export is removed in 0.5. */
export const npv: typeof excelNpv = excelNpv;
/** @deprecated Moved to `@ducatjs/money/excel`; this re-export is removed in 0.5. */
export const npvExact: typeof excelNpvExact = excelNpvExact;
/** @deprecated Excel's IRR moved to `@ducatjs/money/excel`; this re-export is removed in 0.5. */
export const irr: typeof excelIrr = excelIrr;
/** @deprecated Moved to `@ducatjs/money/excel`; this re-export is removed in 0.5. */
export type IrrOptions = ExcelIrrOptions;
/** @deprecated Moved to `@ducatjs/money/excel`; this re-export is removed in 0.5. */
export type IrrResult = ExcelIrrResult;
