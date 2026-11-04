# secretvariable CLI

Pull, push and run `.env` files stored in a SecretVariable server.

```bash
sv login --server https://secrets.example.com
sv init                 # link this folder to a project
sv pull                 # write .env from the current environment
sv push -m "rotate key" # upload .env as a new version
sv run -- npm start     # inject variables without writing a file
```

Run `sv help` for every command. For CI, set `SECRETVARIABLE_URL` and `SECRETVARIABLE_TOKEN` (a service token from `sv token create`) instead of logging in.
