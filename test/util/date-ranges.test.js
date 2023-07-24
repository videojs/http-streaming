import QUnit from 'qunit';
// import sinon from 'sinon';
// import window from 'global/window';
import DateRangesStorage from '../../src/util/date-ranges';
import xhrFactory from '../../src/xhr';
import { useFakeEnvironment } from '../test-helpers';
// needed for plugin registration
import '../../src/videojs-http-streaming';

QUnit.module('DateRanges storage', {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
    this.fakeVhs = {
      xhr: xhrFactory()
    };
  },
  afterEach() {
    this.env.restore();
  }
});

QUnit.test('offset is set', function(assert) {
  const dateRangesStorage = new DateRangesStorage();
  const segments = [{
    programDateTime: 2000,
    duration: 1
  }, {
    programDateTime: 3000,
    duration: 1
  }];

  dateRangesStorage.setOffset(segments);
  assert.equal(dateRangesStorage.offset_, 2, 'offset is the PDT of the first segment');
});

QUnit.test('daterange text track cues - endDate is used for endTime calculation', function(assert) {
  const dateRangesStorage = new DateRangesStorage();
  const segments = [{
    programDateTime: 2000,
    duration: 1
  }, {
    programDateTime: 3000,
    duration: 1
  }];
  const dateRanges = [{
    startDate: new Date(2000),
    scte35Out: '0xFC30200C00C00000E4612424',
    endDate: new Date(3000),
    id: 'testId1'
  }];

  dateRangesStorage.setOffset(segments);
  dateRangesStorage.setPendingDateRanges(dateRanges);

  const dateRangesToProcess = dateRangesStorage.getDateRangesToProcess();

  assert.equal(dateRangesToProcess.length, 1, '1 dateRange exists in dateRangesToProcess array');
  assert.equal(dateRangesToProcess[0].endTime, 1);
});

QUnit.test('daterange text track cues - endOnNext and classList are used', function(assert) {
  const dateRangesStorage = new DateRangesStorage();
  const segments = [{
    programDateTime: 2000,
    duration: 1
  }, {
    programDateTime: 3000,
    duration: 1
  }];
  const dateRanges = [{
    startDate: new Date(3000),
    scte35Out: '0xFC30200C00C00000E4612424',
    id: 'testId1',
    class: 'TestClass',
    endOnNext: true
  }, {
    startDate: new Date(4000),
    scte35Out: '0xFC3020034BCC00000E46',
    id: 'testId2',
    class: 'TestClass'
  }];

  dateRangesStorage.setOffset(segments);
  dateRangesStorage.setPendingDateRanges(dateRanges);
  const dateRangesToProcess = dateRangesStorage.getDateRangesToProcess();

  assert.equal(dateRangesToProcess[0].endTime, 2, 'startTime of the next dateRange with the same class is used as endTime');
});

QUnit.test('daterange text track cues - plannedDuration is used for endTime calculation', function(assert) {
  const dateRangesStorage = new DateRangesStorage();
  const segments = [{
    programDateTime: 2000,
    duration: 1
  }, {
    programDateTime: 3000,
    duration: 1
  }];
  const dateRanges = [{
    startDate: new Date(3000),
    scte35Out: '0xFC30200C00C00000E4612424',
    id: 'testId1',
    plannedDuration: 40
  }];

  dateRangesStorage.setOffset(segments);
  dateRangesStorage.setPendingDateRanges(dateRanges);
  const dateRangesToProcess = dateRangesStorage.getDateRangesToProcess();

  assert.equal(dateRangesToProcess[0].endTime, 41, 'endTime is startTime + plannedDuration is used when endDate, class and duration not available');
});

QUnit.test('daterange text track cues - duration is used for endTime calculation', function(assert) {
  const dateRangesStorage = new DateRangesStorage();
  const segments = [{
    programDateTime: 2000,
    duration: 1
  }, {
    programDateTime: 3000,
    duration: 1
  }];
  const dateRanges = [{
    startDate: new Date(3000),
    scte35Out: '0xFC30200C00C00000E4612424',
    id: 'testId1',
    duration: 40
  }];

  dateRangesStorage.setOffset(segments);
  dateRangesStorage.setPendingDateRanges(dateRanges);
  const dateRangesToProcess = dateRangesStorage.getDateRangesToProcess();

  assert.equal(dateRangesToProcess[0].endTime, 41, 'duration is used when endDate and class not available');
});
