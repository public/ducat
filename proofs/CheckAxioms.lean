import Ducat

/-! `lake env lean CheckAxioms.lean` lists the axioms behind each headline theorem. `pnpm gen:kernel:check` fails
unless they are only Lean's standard three: `propext`, `Classical.choice` and `Quot.sound`. -/

#print axioms Ducat.kernel_sound
#print axioms Ducat.rounds_unique
#print axioms Ducat.kernel_fails_iff
#print axioms Ducat.kernel_correct
#print axioms Ducat.Alloc.alloc_sum
#print axioms Ducat.Alloc.alloc_zero
#print axioms Ducat.Alloc.alloc_near
#print axioms Ducat.Alloc.alloc_near_largest
#print axioms Ducat.Alloc.allocS_neg
#print axioms Ducat.Alloc.alloc_scale
#print axioms Ducat.addTax_bound
#print axioms Ducat.extractTax_bound
#print axioms Ducat.rounds_half_bound
#print axioms Ducat.rounds_directed_bound
#print axioms Ducat.toScale_roundtrip
#print axioms Ducat.divRound_mul_left
#print axioms Ducat.divRound_exact
#print axioms Ducat.Sched.inst_sum
#print axioms Ducat.Sched.inst_multiple
#print axioms Ducat.Sched.inst_near
#print axioms Ducat.Sched.chunk_sum
#print axioms Ducat.Sched.chunk_le
#print axioms Ducat.Sched.chunk_full
#print axioms Ducat.Sched.chunk_last_pos
#print axioms Ducat.Sched.sched_sum
#print axioms Ducat.Sched.sched_pct_near
#print axioms Ducat.increment_multiple
#print axioms Ducat.increment_near
#print axioms Ducat.increment_half
#print axioms Ducat.increment_exact
#print axioms Ducat.increment_idem
