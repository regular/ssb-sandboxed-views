const View = require('..')
const pull = require('pull-stream')

const flumelog = {
  filename: __dirname + '/flume',
  get:(key, cb)=>{
    cb(new Error('get!'))
  }
}

const prop = 'type'
const code = `
  module.exports = function(kv) {
    const {key, value} = kv
    let propValue = value && value.content && value.content["${prop}"] || []
    if (!Array.isArray(propValue)) propValue = [propValue]

    const revisionRoot = (value && value.content && value.content.revisionRoot) || key

    return propValue.map(x => [x, revisionRoot])
  }
  `
const makeView = View(flumelog)
const view = makeView(code)
view.since.once( since=>{
  console.log(`since: ${since}`)
  console.log(`code fingerprint: ${view.fingerprint}`)
  pull(
    pull.values(msgs(4)),
    view.createSink( err=>{
      console.error(`sink error: ${err == true ? err : err && err.message}`)
      console.error(`     stack: ${err == true ? err : err && err.stack}`)
    })
  )
})

let newSince = 0
function msgs(count) {
  const ret = []
  for(let i=0; i<count; i++) {
    ret.push({value:m(i), old_value: m(i)})
    newSince++
  }
  ret.push({since: newSince})
  return ret
}

function m(seq) {
  return {
    key: 'foo',
    seq,
    value: {
      content: {
        type: 'post',
        test: 'blah'
      }
    }
  }
}
