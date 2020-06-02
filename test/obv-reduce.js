const Obv = require('obv')
const obvReduce = require('../obv-reduce')
const test = require('tape')

test('reduce & update', t=>{
  const obv1 = Obv()
  const obv2 = Obv()
  const obv3 = Obv()
  const acc = {value: 100}
  let three = false

  function parents() {
    if (!three) {
      return [obv1, obv2]
    }
    return [obv1, obv2, obv3]
  }

  function reduce(acc, x) {
    return (acc < x || x == undefined) ? acc : x
  }
  
  const reduced = obvReduce(parents, reduce, acc)

  t.equal(reduced.value, acc.value, 'should be acc value when parents have no value')
  obv1.set(10)
  t.equal(reduced.value, 10, 'should be smallest')
  obv2.set(5)
  t.equal(reduced.value, 5, 'should be smallest')

  three = true
  obv3.set(1)
  reduced.update()
  t.equal(reduced.value, 1, 'should be smallest')

  t.end()
})

test('Calling listeners', t =>{
  const parents = []
  function reduce(acc, x) {
    return (acc < x || x == undefined) ? acc : x
  }
  const reduced = obvReduce(()=>parents, reduce, {value: 1000})

  const results = []
  reduced(v=>{
    console.log(v)
    results.push(v)
  })

  parents.push(Obv())
  reduced.update()
  parents[0].set(1)
  parents[0].set(2)

  parents.push(Obv())
  reduced.update()
  parents[1].set(100)
  parents[0].set(3)
  parents[1].set(200)
  parents[1].set(0)
  
  t.deepEqual(results, [1000,1,2,3,0])
  t.end()
})
