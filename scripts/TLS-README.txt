Corporate TLS interception (npm: UNABLE_TO_VERIFY_LEAF_SIGNATURE)
===================================================================

1. Export your organization's inspection ROOT certificate as a PEM file
   (.crt text format with -----BEGIN CERTIFICATE-----).

2. Save it HERE (never commit PEM files; they stay gitignored):

      Windows App/.certs/npm-extra-ca.pem

3. Install JavaScript dependencies with the wrapper:

      npm run deps

   This sets NODE_EXTRA_CA_CERTS only for that npm subprocess so registry
   TLS validates without disabling strict-ssl globally.

4. Prefer this over NPM_CONFIG_STRICT_SSL=false when possible.
