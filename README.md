ssb-sandboxed-views
---
This plug-in for ssb-server enables applications to build and query the database indexes they need, without requiring further plug-ins. The goal is for a single instance of ssb-server to serve many different applications with different database views. A view (= indexing function) can be added dynamically. The function then runs in an isolated JS context (quickjs) in a worker thread of ssb-server. The resulting index is identical to the ones created by ssb-review-level/flumeview-level and can be queried in a similar fashion.

## Known issues/status

This is experimental and some parts are not implemented yet.

- currently requires ssb-revisions and exclusively creats views that support mutations
- lifetime of leveldb is not managed yet. (databases are created and never deleted)
- no protection agains endless loops in map functions yet

## How it works

An application calls ssb.sandviews.openView() with the _source code_ of a commonJS module that exports the map function. The map function is called whenever a message is added to the flumelog or, in case ssb-revisions is present in the ssb-server stack of plugins, when a messages is mutated. The map functions output is then written to a leveldb database. 

### Versioning

Instead of relying on manual version number bumping like in flumeview-level and ssb-revisions, ssb-sandboxed-views creates a _code fingerprint_ of the application-provided function. If the fingerprint changes, a new index will be build and the old one will eventually by purged if no application has used it for a while (not implemented). The idea of a _code fingerprint_ is that it does not change if the source code changes are trivial and don't affect the output. Changes in formatting, comments, variable and function names, braces around single-statement if-blocks, etc, will not change the fingerprint.

Applications that provide map functions with identical fingerprints will automatically share the index.

### Security

For security reasons, the code provided by the application does not run in NodeJS directly, instead an instance of sandbox-worker is created, so that the code runs in an isolated JS runtime implemented by quickjs with no access to any NodeJS module. This ensure that the application-provided code cannot interact with the host system or the network. To protect against endless loops, the quickjs runtime runs in a worker thread. (no timeout is implemented yet though)

## API

### `openView(code[, opts], cb)`

instanciates a view with the given `source code`. If the view does not exist, it will be created.

  - `code` source code of a commonJS module that exports a single function, the map function (see below)
  - `opts` options object
    - `bufferSize` number of messages to buffer before sending to worker thrad. Defaults to 200.
    - `warnings` if set to an empty array (or any other object with a `push` property), will receive warnings issued by terser, for example if dead code was deleted.

  - `cb` is called with `err` and `handle`
    - `handle` is the view's handle/id. It is used in the remaining functions of the API.

### `get(handle, key, cb)`

get a single index entry.

  - `handle` as created by openView
  - `key` as returned by the map function

### `read(handle[, opts])`

Query a sandboxed view.

  - `handle` as created by openView
  - `opts` same as in flumeview-level

returns a pull-stream source

License: MIT
