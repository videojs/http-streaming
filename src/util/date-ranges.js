export default class DateRangesStorage {
  constructor() {
    this.offset_ = null;
    this.pendingDateRanges_ = new Map();
    this.processedDateRanges_ = new Map();
  }

  setOffset(segments = []) {
    // already set
    if (this.offset_ !== null) {
      return;
    }
    // no segment to process
    if (!segments.length) {
      return;
    }

    const [firstSegment] = segments;

    // no program date time
    if (firstSegment.programDateTime === undefined) {
      return;
    }
    // Set offset as ProgramDateTime for the very first segment of the very first playlist load:
    this.offset_ = firstSegment.programDateTime / 1000;
  }

  setPendingDateRanges(dateRanges = []) {
    if (!dateRanges.length) {
      return;
    }

    const [dateRange] = dateRanges;
    const startTime = dateRange.startDate.getTime();

    this.trimProcessedDateRanges_(startTime);

    this.pendingDateRanges_ = dateRanges.reduce((map, pendingDateRange) => {
      map.set(pendingDateRange.id, pendingDateRange);
      return map;
    }, new Map());
  }

  processDateRange(dateRange) {
    this.pendingDateRanges_.delete(dateRange.id);
    this.processedDateRanges_.set(dateRange.id, dateRange);
  }

  getDateRangesToProcess() {
    if (this.offset_ === null) {
      return [];
    }

    const dateRangeClasses = {};
    const dateRangesToProcess = [];

    this.pendingDateRanges_.forEach((dateRange, id) => {
      if (this.processedDateRanges_.has(id)) {
        return;
      }

      dateRange.startTime = (dateRange.startDate.getTime() / 1000) - this.offset_;
      dateRange.processDateRange = () => this.processDateRange(dateRange);
      dateRangesToProcess.push(dateRange);

      if (!dateRange.class) {
        return;
      }

      if (dateRangeClasses[dateRange.class]) {
        const length = dateRangeClasses[dateRange.class].push(dateRange);

        dateRange.classListIndex = length - 1;
      } else {
        dateRangeClasses[dateRange.class] = [dateRange];
        dateRange.classListIndex = 0;
      }
    });

    for (const dateRange of dateRangesToProcess) {
      const classList = dateRangeClasses[dateRange.class] || [];

      if (dateRange.endDate) {
        dateRange.endTime = (dateRange.endDate.getTime() / 1000) - this.offset_;
      } else if (dateRange.endOnNext && classList[dateRange.classListIndex + 1]) {
        dateRange.endTime = classList[dateRange.classListIndex + 1].startTime;
      } else if (dateRange.duration) {
        dateRange.endTime = dateRange.startTime + dateRange.duration;
      } else if (dateRange.plannedDuration) {
        dateRange.endTime = dateRange.startTime + dateRange.plannedDuration;
      } else {
        dateRange.endTime = dateRange.startTime;
      }
    }

    return dateRangesToProcess;
  }

  trimProcessedDateRanges_(startTime) {
    const copy = new Map(this.processedDateRanges_);

    copy.forEach((dateRange, id) => {
      if (dateRange.startDate.getTime() < startTime) {
        this.processedDateRanges_.delete(id);
      }
    });
  }
}
