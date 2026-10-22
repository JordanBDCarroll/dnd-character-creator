// Deployment config, loaded before the main script in index.html.
window.DND_API_BASE = '/api/2014';
// Open5e supplies extra backgrounds (the SRD only has Acolyte). It is the one external call.
// To disable it (no third-party requests): set this to '' AND remove
// https://api.open5e.com from connect-src in deploy/Caddyfile.
window.OPEN5E_BASE = 'https://api.open5e.com/v1';
