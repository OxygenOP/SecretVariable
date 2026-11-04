# secretvariable CLI

Pull, push and run `.env` files stored in a SecretVariable server.

```bash
secvar login --server https://secrets.example.com
secvar init                 # link this folder to a project
secvar pull                 # write .env from the current environment
secvar push -m "rotate key" # upload .env as a new version
secvar run -- npm start     # inject variables without writing a file
```

Run `secvar help` for every command. For CI, set `SECRETVARIABLE_URL` and `SECRETVARIABLE_TOKEN` (a service token from `secvar token create`) instead of logging in.
