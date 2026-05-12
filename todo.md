# Todo

- [x] Authenticate kiosks. Each kiosk should authenticate itself on boot to be able to access APIs.
- [x] There is no token validation in the socket auth handler. It's just blindly trusted.
- [x] Respect `includeIndividuals` and `includeGroups` when importing data using the Scoutnet data source.
- [ ] Admin view to see group checking process. Might be separate system.
- [ ] Map to show on info screens showing checkin process. Map app maybe?
- [x] Add step to block progression. For example if not leader.
- [ ] The GitHub Expressions package now works with ESM. Update and remove clone.
- [ ] Investigate whether removing `external: pluginExternals` from `vite.config.ts` breaks HMR for plugin code in dev. Removed it to fix bare specifier error in prod (`@scouterna/scoutin-plugin-base/frontend` not remapped). Claim is that `build.rollupOptions.external` is prod-only and doesn't affect the dev server.
