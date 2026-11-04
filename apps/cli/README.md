# secretvariable CLI

Pull, push and run `.env` files stored in a SecretVariable server.

```bash
secretvariable login --server https://secrets.example.com
secretvariable init                 # link this folder to a project
secretvariable pull                 # write .env from the current environment
secretvariable push -m "rotate key" # upload .env as a new version
secretvariable run -- npm start     # inject variables without writing a file
```

Run `secretvariable help` for every command. For CI, set `SECRETVARIABLE_URL` and `SECRETVARIABLE_TOKEN` (a service token from `secretvariable token create`) instead of logging in.
