// CSS side-effect imports (e.g. `import "./styles/app.css"`) carry no types —
// esbuild bundles the stylesheet at build time and the TS compiler only needs to
// know the module exists. TS6 requires this ambient declaration (TS5 accepted the
// bare side-effect import without one; TS2882 otherwise).
declare module "*.css";
