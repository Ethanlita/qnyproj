// Silent token renewal
// NOTE: This file is served as a static resource, DO NOT use ES6 import syntax
(function() {
  // oidc-client-ts must be loaded via CDN in silent-renew.html
  if (typeof window.oidc === 'undefined') {
    console.error('[Silent Renew] oidc-client-ts not loaded');
    return;
  }

  var UserManager = window.oidc.UserManager;
  var WebStorageStateStore = window.oidc.WebStorageStateStore;

  var userManager = new UserManager({
    response_mode: 'query',
    userStore: new WebStorageStateStore({ store: window.localStorage })
  });

  userManager.signinSilentCallback().catch(function(err) {
    console.error('[Silent Renew] Error:', err);
  });
})();
