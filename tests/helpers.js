import _ from "lodash";

export function CallableMock(conf) {
  conf = _.assign({
    returnValue: undefined,
  }, conf);
  this.call = null;
  this.wasCalled = false;
  this.returnValue = conf.returnValue;
}

CallableMock.prototype._call = function() {
  this.call = arguments;
  this.wasCalled = true;
  return this.returnValue;
};

CallableMock.prototype.getCallable = function() {
  return this._call.bind(this);
};
