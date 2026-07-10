# Todo

- [x] Authenticate kiosks. Each kiosk should authenticate itself on boot to be able to access APIs.
- [x] There is no token validation in the socket auth handler. It's just blindly trusted.
- [x] Respect `includeIndividuals` and `includeGroups` when importing data using the Scoutnet data source.
- [ ] Admin view to see group checking process. Might be separate system.
- [ ] Map to show on info screens showing checkin process. Map app maybe?
- [x] Add step to block progression. For example if not leader.
- [ ] The GitHub Expressions package now works with ESM. Update and remove clone.
- [ ] Investigate whether removing `external: pluginExternals` from `vite.config.ts` breaks HMR for plugin code in dev. Removed it to fix bare specifier error in prod (`@scouterna/scoutin-plugin-base/frontend` not remapped). Claim is that `build.rollupOptions.external` is prod-only and doesn't affect the dev server.
- [ ] `loadAllDataSourcesIntoDatabase` should run on a schedule or something like that.
- [ ] Add auth to the admin interface and routes.
- [ ] Two steps with the same `uses` value in a config (e.g. two `base:message` steps) will cause the second to be silently skipped — `findNextStepDefinition` matches on `stepId` and finds the first completion record. Either enforce uniqueness of `uses` per config or track step index in `CheckinSessionStepData`.
- [ ] Kiosk: When network goes out, the websocket connection is lost and not reconnected.
- [ ] `identify.ts`'s `searchCandidates` silently drops a matched participant whose `dataSource` is no longer present in `dataSourceConfig.yml` (e.g. stale rows left over from a data source since removed/commented out) instead of surfacing it anywhere. Fixed the crash this used to cause (it previously threw), but we should log or warn when this happens so it doesn't go unnoticed.
