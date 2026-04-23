export interface LogEvent {
  timestamp: string;
  nanoseconds: number;
  eventType: string;
  lineNumber?: number;
  details: string;
  raw: string;
}

export interface ParsedLog {
  header: string;
  apiVersion: string;
  logLevels: Record<string, string>;
  events: LogEvent[];
}

export class ApexLogParser {
  parse(log: string): ParsedLog {
    const lines = log.split(/\r?\n/);
    const events: LogEvent[] = [];
    const header = lines[0] || '';
    const { apiVersion, logLevels } = this.parseHeader(header);

    const eventRegex = /^(\d{2}:\d{2}:\d{2}\.\d+)\s*\((\d+)\)\|([A-Z_]+)(\|.*)?$/;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const m = eventRegex.exec(line);
      if (m) {
        const [, timestamp, nanos, eventType, rest] = m;
        const detailsPart = rest ? rest.substring(1) : '';
        const lineMatch = /^\[(\d+)\]/.exec(detailsPart);
        const lineNumber = lineMatch ? Number(lineMatch[1]) : undefined;
        const details = lineMatch
          ? detailsPart.substring(lineMatch[0].length).replace(/^\|/, '')
          : detailsPart;

        events.push({ timestamp, nanoseconds: Number(nanos), eventType, lineNumber, details, raw: line });
      } else if (events.length > 0 && line.trim()) {
        const last = events[events.length - 1];
        last.raw += '\n' + line;
        last.details += '\n' + line;
      }
    }
    return { header, apiVersion, logLevels, events };
  }

  private parseHeader(header: string) {
    const parts = header.trim().split(/\s+/);
    const apiVersion = parts[0] || '';
    const levelsStr = parts.slice(1).join(' ');
    const logLevels: Record<string, string> = {};
    for (const pair of levelsStr.split(';')) {
      const [k, v] = pair.split(',');
      if (k && v) {logLevels[k.trim()] = v.trim();}
    }
    return { apiVersion, logLevels };
  }
}