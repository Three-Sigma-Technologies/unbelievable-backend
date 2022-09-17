const objectCleaner = (propsArr = [], obj = {}) => {
  propsArr.forEach((prop) => {
    delete obj[prop];
  });
  return obj;
};

module.exports = objectCleaner;
