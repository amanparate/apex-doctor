## Connect once, use everywhere

```bash
npm install --global @salesforce/cli
sf org login web --set-default
```

For a sandbox:

```bash
sf org login web --instance-url https://yourdomain--sandbox.sandbox.my.salesforce.com --set-default
```

Apex Doctor uses your default org. It never sees your password or tokens — the Salesforce CLI handles authentication.
