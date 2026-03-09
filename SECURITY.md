# Security Policy / 安全策略

## Reporting / 漏洞报告方式

If you find a security issue, please **do not** post exploit details, real credentials, or production endpoints in a public issue.

如果你发现安全问题，请**不要**在公开 issue 中披露利用细节、真实凭证或生产环境地址。

Use the repository's **GitHub Security Advisory** flow:

1. Open the repository **Security** tab.
2. Choose **Report a vulnerability**.
3. Provide the minimum information required to reproduce the issue safely.

If GitHub Security Advisories are temporarily unavailable for the repository, open a minimal public issue titled like `Security contact request` and do **not** include secrets, exploit details, or production endpoints in the public thread.

## Sensitive data handling / 敏感信息处理

Do not share any of the following in issues, PRs, screenshots, or logs:

- exchange API keys / secrets / passphrases
- bearer tokens / JWT secrets
- `.env` values
- Redis DSNs from real environments
- local databases or operational logs with real request metadata

## Deployment expectations / 部署安全预期

Before any public deployment, verify:

- authentication is enabled
- rate limiting is enabled
- audit logging is enabled
- CORS is restricted to intended origins
- secrets are injected through a secure environment, not committed files
- task/state persistence is configured appropriately for your backend mode

## Browser expectation / 浏览器侧约束

Live monitoring credentials should only be stored when the user explicitly opts in.
Shared or demo devices should not retain saved credentials.
