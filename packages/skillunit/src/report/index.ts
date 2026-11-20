import { github } from './github.js';
import { junit } from './junit.js';
import { table } from './table.js';
import type { CheckReport, ReporterName, ReportOptions } from './types.js';

export { colorByDefault } from './text.js';
export * from './types.js';

export function render(report: CheckReport, reporter: ReporterName, options: ReportOptions): string {
  switch (reporter) {
    case 'json':
      return `${JSON.stringify(report, null, 2)}\n`;
    case 'junit':
      return junit(report, options);
    case 'github':
      return github(report, options);
    case 'table':
      return table(report, options);
  }
}
