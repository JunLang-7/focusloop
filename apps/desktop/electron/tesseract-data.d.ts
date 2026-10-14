/**
 * The shape of the traineddata packages, which ship no types of their own.
 *
 * `tesseract.js` fetches language data from a CDN unless it is pointed at a directory, and these packages
 * are that directory: each one exports where its own file lives. Declared rather than cast, because the
 * three fields are the whole contract the OCR reader depends on — and getting one of them wrong by
 * spelling is what a type is for.
 */
declare module '@tesseract.js-data/eng' {
  const data: { readonly code: string; readonly gzip: boolean; readonly langPath: string };
  export default data;
}

declare module '@tesseract.js-data/chi_sim' {
  const data: { readonly code: string; readonly gzip: boolean; readonly langPath: string };
  export default data;
}
