/**
 * Design-preview switch for the Home page.
 *
 * Preview renders the approved design with typed fixtures where a backend capability does not exist
 * yet (published routines, public concerns). It is on in development, and in any build only when
 * NEXT_PUBLIC_HOME_PREVIEW=true. It is off in production builds by default, and NEXT_PUBLIC_HOME_PREVIEW=false
 * turns it off in development. Fixtures are only ever used when this returns true: a failed or empty real
 * response never switches them on by itself.
 */
export function isHomePreview(): boolean {
  const flag = process.env.NEXT_PUBLIC_HOME_PREVIEW;
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return process.env.NODE_ENV === 'development';
}

/**
 * Illustrative product cards for an EMPTY catalog: development only AND explicitly requested with
 * `?preview=products`. Never on by default, never in production builds.
 */
export function isProductPreview(searchParam: string | string[] | undefined): boolean {
  return process.env.NODE_ENV === 'development' && searchParam === 'products';
}
