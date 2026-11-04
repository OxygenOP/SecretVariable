# secretvariable CLI

Pull, push and run `.env` files stored in a SecretVariable server.

```bash
svar login --server https://secrets.example.com
svar init                 # link this folder to a project
svar pull                 # write .env from the current environment
svar push -m "rotate key" # upload .env as a new version
svar run -- npm start     # inject variables without writing a file
```

Run `svar help` for every command. For CI, set `SECRETVARIABLE_URL` and `SECRETVARIABLE_TOKEN` (a service token from `svar token create`) instead of logging in.
