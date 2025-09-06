const View = require('../view')
const pull = require('pull-stream')

const ssb = {
  get:(key, cb)=>{
    cb(new Error('get!'))
  }
}

const prop = 'editors'
const code = `
  module.exports = function(kv) {
    const {key, value} = kv
    let propValue = value && value.content && value.content["${prop}"] || []
    if (!Array.isArray(propValue)) propValue = [propValue]

    return propValue
  }
  `
const makeView = View(ssb, `/tmp/sandviews-${Date.now()}`)
const view = makeView(code, {mutate: false})
view.since.once( since=>{
  console.log(`since: ${since}`)
  console.log(`code fingerprint: ${view.fingerprint}`)
  pull(
    pull.values(msgs(11)),
    view.createSink( err=>{
      console.error(`sink error: ${err == true ? err : err && err.message}`)
      console.error(`     stack: ${err == true ? err : err && err.stack}`)
      pull(
        view.read({values: false}),
        pull.drain(e=>{
          console.log(e)
        }, err=>{
          console.log('err', err)
        })
      )
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
    key: `key-${seq}`,
    seq,
    value: {
      content: {
        type: 'post',
        editors: ['one', 'two'],
        test: 'blah'
      }
    }
  }
}
