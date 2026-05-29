/**
 * Shell command wrapper.
 *
 * Re-exports Bun's `$` shell function from a user-space module so that
 * `mock.module` can intercept it in tests.
 */
export { $ } from "bun";
