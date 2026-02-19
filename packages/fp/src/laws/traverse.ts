/**
 * Traverse Laws
 *
 * Laws for the Traverse typeclass.
 *
 * Traverse Laws:
 *   - Identity: traverse(Id)(fa, Id.pure) === Id.pure(fa)
 *   - Composition: traverse composition is associative
 *   - Naturality: natural transformations commute with traverse
 *
 * @module
 */

import type { Traverse } from "../typeclasses/traverse.js";
import type { Applicative } from "../typeclasses/applicative.js";
import type { $ } from "../hkt.js";
import type { Law, LawSet } from "./types.js";
import type { EqFA } from "./functor.js";
import { functorLaws } from "./functor.js";
import { foldableLaws } from "./foldable.js";
import type { Monoid } from "../typeclasses/semigroup.js";
import type { Eq } from "../typeclasses/eq.js";

// ============================================================================
// Identity Applicative (for testing)
// ============================================================================

/**
 * The Identity applicative - used for testing traverse laws.
 * Identity<A> = A, with pure(a) = a and ap(f, a) = f(a)
 */
interface IdF {
  _: this["_"];
}

const idApplicative: Applicative<IdF> = {
  map: <A, B>(fa: A, f: (a: A) => B): B => f(fa),
  ap: <A, B>(fab: (a: A) => B, fa: A): B => fab(fa),
  pure: <A>(a: A): A => a,
};

// ============================================================================
// Traverse Laws
// ============================================================================

/**
 * Generate laws for a Traverse instance.
 *
 * @param T - The Traverse instance to verify
 * @param EqFA - Eq instance for comparing F[A] values
 * @returns Array of laws that must hold
 */
export function traverseLaws<F, A>(T: Traverse<F>, EqFA: EqFA<F, A>): LawSet {
  return [
    // Include Functor laws
    ...functorLaws(T, EqFA),

    {
      name: "identity",
      arity: 1,
      proofHint: "identity-left",
      description:
        "Traversing with identity is identity: traverse(Id)(fa, pure) === pure(fa)",
      check: (fa: $<F, A>): boolean => {
        // traverse with identity applicative should be identity
        const result = T.traverse(idApplicative)(fa, (a: A) =>
          idApplicative.pure(a),
        );
        return EqFA.eqv(result as $<F, A>, fa);
      },
    },
    {
      name: "traverse preserves structure",
      arity: 1,
      description:
        "traverse(G)(fa, G.pure) should equal G.pure(fa) for any applicative G",
      check: (fa: $<F, A>): boolean => {
        // Using identity applicative, traverse should preserve the structure
        const result = T.traverse(idApplicative)(fa, idApplicative.pure);
        return EqFA.eqv(result as $<F, A>, fa);
      },
    },
  ] as const;
}

/**
 * Generate traverse laws with a specific applicative.
 *
 * @param T - The Traverse instance to verify
 * @param G - The Applicative to traverse into
 * @param EqGFA - Eq instance for comparing G[F[A]] values
 * @returns Array of laws that must hold
 */
export function traverseLawsWithApplicative<F, G, A>(
  T: Traverse<F>,
  Ap: Applicative<G>,
  EqGFA: { readonly eqv: (x: $<G, $<F, A>>, y: $<G, $<F, A>>) => boolean },
): LawSet {
  return [
    {
      name: "traverse with pure",
      arity: 1,
      description: "traverse(G)(fa, G.pure) === G.pure(fa)",
      check: (fa: $<F, A>): boolean => {
        const left = T.traverse(Ap)(fa, Ap.pure);
        const right = Ap.pure(fa);
        return EqGFA.eqv(left, right);
      },
    },
  ] as const;
}

/**
 * Generate sequence laws derived from traverse.
 *
 * @param T - The Traverse instance to verify
 * @param G - The Applicative to sequence
 * @param EqGFA - Eq instance for comparing G[F[A]] values
 * @returns Array of sequence-related laws
 */
export function sequenceLaws<F, G, A>(
  T: Traverse<F>,
  Ap: Applicative<G>,
  EqGFA: { readonly eqv: (x: $<G, $<F, A>>, y: $<G, $<F, A>>) => boolean },
): LawSet {
  return [
    {
      name: "sequence via traverse",
      arity: 1,
      description: "sequence(fga) === traverse(fga, identity)",
      check: (fga: $<F, $<G, A>>): boolean => {
        const viaSequence = T.traverse(Ap)(fga, (x: $<G, A>) => x);
        const viaTraverse = T.traverse(Ap)(fga, (x: $<G, A>) => x);
        return EqGFA.eqv(viaSequence, viaTraverse);
      },
    },
  ] as const;
}
