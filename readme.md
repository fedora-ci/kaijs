# Run loader locally

```
podman run -p 27017:27017 -e MONGODB_USERNAME=user -e MONGODB_PASSWORD=password -e MONGODB_DATABASE=ci-messages -e MONGODB_ROOT_PASSWORD=passwordrootmongodb  bitnami/mongodb:latest
LOADER_DB_URL='mongodb://root:passwordrootmongodb@127.0.0.1' DEBUG="kaijs:*" npm run "dev:loader"
PGHOST=virtualdb... PGPORT=5432 PGUSER=... PGDATABASE=public PGPASSWORD=... ./osci  dumpmsg -t '/topic/VirtualTopic\.eng\.ci\.osci\.brew-build\.test\.complete'  --ts 2022-03-10 --dir /home/andrei/osci/kaijs/messages-queue
./osci  dumpmsg -t '/topic/VirtualTopic\.eng\.brew\.build\.tag:.*rhel-\d+\S+-gate".*' --ts 2022-05-17 --dir /queue
```
