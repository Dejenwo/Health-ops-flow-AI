# Single sign-on

HealthFlow supports sign-in with Microsoft Entra ID (Microsoft 365), Google Workspace, and any
OpenID Connect provider such as Okta, Ping or OneLogin.

## For the HealthFlow operator (one time)

Register one multi-tenant app per provider and put the credentials in the environment.
The redirect URI for all of them is `{NEXT_PUBLIC_APP_URL}/api/auth/sso/callback`.

**Microsoft**
1. Entra admin center > App registrations > New registration.
2. Supported account types: *Accounts in any organizational directory (multitenant)*.
3. Redirect URI (Web): the callback above.
4. Certificates & secrets > New client secret.
5. Token configuration > add the optional `email` claim to the ID token.
6. Set `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`.

**Google**
1. Google Cloud console > APIs & Services > Credentials > Create OAuth client ID (Web application).
2. Authorized redirect URI: the callback above.
3. Set the consent screen to *External* so any Workspace customer can sign in.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Other OIDC providers need nothing from the operator; each customer registers their own app.

## For a customer admin

Settings > Security > Single sign-on.

1. **Verify your domain.** Add `yourclinic.org`, then create the TXT record shown
   (`_healthflow.yourclinic.org` = `healthflow-verification=...`) and click Verify.
2. **Connect your provider.**
   - Microsoft: paste your directory (tenant) ID. A Global Administrator must consent to the
     HealthFlow app the first time someone signs in.
   - Google: nothing else to enter.
   - Okta and others: create an OIDC Web app with the redirect URI shown, allow
     `client_secret_basic`, and paste the issuer URL, client ID and client secret.
3. **Choose how people join.** Turn on automatic accounts if everyone in the domain should get
   access, and pick their starting role. Otherwise invite people first.
4. **Turn on SSO,** test it in a private window, then turn on **Require SSO** if you want to
   stop member passwords. Owners can still sign in with password and MFA if the identity
   provider is down.

Enforce MFA in your identity provider (for example with Entra Conditional Access). HealthFlow's
own MFA applies only to password sign-ins.

## Security design

- Authorization code flow with PKCE (S256), `state` and `nonce`, held in a signed httpOnly
  cookie scoped to `/api/auth/sso` for 10 minutes.
- ID token signature checked against the provider's published keys, plus issuer, audience,
  expiry (60 s clock tolerance) and a 10-minute maximum age.
- Microsoft: tenant-specific issuer and `tid` must equal the configured tenant. Accounts are keyed
  on `tid` + `oid`, so a changed or spoofed email claim cannot take over another account.
- Google: `hd` must be a verified domain and `email_verified` must be true.
- Other OIDC: `email_verified` must be true and the email domain must be verified.
- Client secrets for custom providers are encrypted with AES-256-GCM.
- Sign-in starts with a GET navigation because the Content Security Policy blocks forms from
  posting to other sites.

## Automatic provisioning (SCIM 2.0)

With SCIM, the identity provider keeps HealthFlow's member list in sync: people are added when
they're assigned to the HealthFlow app and lose access the moment they're disabled or unassigned.

**Set up (customer admin)**
1. Verify a domain (step 1 above). SCIM only accepts people from verified domains.
2. Settings > Security > Automatic provisioning > Generate token. Copy it; it is shown once.
3. Microsoft Entra: Enterprise applications > HealthFlow > Provisioning > Automatic. Tenant URL
   is the one shown on the settings page (`…/api/scim/v2`), Secret token is the token. Test
   connection, then assign users and start provisioning.
4. Okta: the app's Provisioning tab > SCIM 2.0, base URL as above, authentication "HTTP Header"
   with the token. Enable Create, Update and Deactivate.

**Behavior**
- Create: adds the person with the SSO default role (Viewer if SSO isn't set up). Existing
  HealthFlow accounts with the same email are linked, not duplicated.
- Deactivate, unassign or DELETE: suspends the membership and ends every session immediately.
  Nothing is deleted, so case history and audit logs stay intact. Reactivation restores access.
- Name and email changes are applied. Email changes must stay within a verified domain.
- Owners can't be deactivated or renamed through SCIM, so a misconfigured provider can't lock an
  organization out. Change owners inside HealthFlow.
- Roles are managed in HealthFlow, not by SCIM. Groups are not supported.
- Supported filters: `userName eq`, `externalId eq`, `emails.value eq`.
- Only a SHA-256 hash of the token is stored. Replacing or turning off the token takes effect at once.
- Every change is written to the audit log (`scim.user_created`, `scim.user_deactivated`,
  `scim.user_reactivated`, `scim.user_updated`, token events).

## Not yet included

SAML (most customers can use OIDC instead) and SCIM Groups.
