const _ = require('lodash');

/**
 * https://stackoverflow.com/questions/36128171/list-all-possible-paths-using-lodash
 * 
 * For:
  
  var obj = {
    a: '1',
    b: { foo: '2', bar: 3 },
    c: [{ d: 1 }, { d2: [[{ d3: 'nested' }]] }, 1],
  };
  
 * Result : ["a", "b.foo", "b.bar", "c.0.d", "c.1.d2.0.0.d3", "c.2"]

 * This format is prefferable, accessors in MongoDB have the same format.
 */
const paths_mongodb = _.flow(
  _.identity,
  _.toPairs,
  _.partialRight(
    _.map,
    _.cond([
      [
        _.flow(
          _.last,
          _.overEvery(
            _.overSome(_.isArray, _.isPlainObject),
            _.negate(_.isEmpty)
          )
        ),
        _.flow(
          _.over([_.head, _.flow(_.last, (o) => paths_mongodb(o))]),
          _.reverse,
          _.over([_.spread(_.overArgs(_.times, [_.size, _.constant])), _.head]),
          _.spread(_.zip),
          _.partialRight(_.map, _.flow(_.identity, _.partialRight(_.join, '.')))
        ),
      ],
      [_.stubTrue, _.initial],
    ])
  ),
  _.flattenDeep
);

/**
 * For:
  
  var obj = {
    a: '1',
    b: { foo: '2', bar: [1,{a:[1]},3] },
    c: [{ d: 1 }, { d2: [[{ d3: 'nested' }]] }, 1],
  };
  Result : ["a", "b.foo", "b.bar", "c"]

  Note: this function must be called with object,
  for array, string it will produce [ '0', '1', '2', '3', '4' ] or ['a', 'b', 'c']
 */
const paths_mongodb_pack_array = _.flow(
  _.identity,
  _.toPairs,
  _.partialRight(
    _.map,
    _.cond([
      [
        /**
         * Condition that we are processing object and it is not emtpy
         */
        _.flow(
          _.last,
          _.overEvery(_.overSome(_.isPlainObject), _.negate(_.isEmpty))
        ),
        /**
         * Process not empty object
         */
        _.flow(
          /**
           * This part will be called only for not-empty object  'o'
           */
          _.over([_.head, _.flow(_.last, (o) => paths_mongodb_pack_array(o))]),
          _.reverse,
          _.over([_.spread(_.overArgs(_.times, [_.size, _.constant])), _.head]),
          _.spread(_.zip),
          _.partialRight(_.map, _.flow(_.identity, _.partialRight(_.join, '.')))
        ),
      ],
      [_.stubTrue, _.initial],
    ])
  ),
  _.flattenDeep
);

/**
 * Path can in 2 forms:
 *
 * a[0].b.c - that understands lodash
 * a.0.b.c - that understands MongoDB
 *
 */
const path_mongodb_to_lodash = _.curry(
  _.partialRight(_.replace, /\.(\d+)/g, '[$1]'),
  1
);
const paths_mongodb_to_lodash = _.partialRight(
  _.map,
  _.unary(path_mongodb_to_lodash)
);

/**
 * isEmpty(obj, "b.bar")
 */
const isEmpty = _.overArgs(_.flow(_.get, _.overSome(_.isUndefined, _.isNull)), [
  _.identity,
  path_mongodb_to_lodash,
]);

/**
 * drop_empty_paths(paths, obj)
 */
const drop_empty_paths = _.overArgs(_.remove, [
  _.identity,
  _.curry(_.ary(isEmpty, 2), 2),
]);

module.exports = {
  paths_mongodb,
  paths_mongodb_pack_array,
  path_mongodb_to_lodash,
  drop_empty_paths,
};
