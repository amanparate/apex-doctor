import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const execAsync = promisify(exec);

export interface UserInfo {
  Id: string;
  Name: string;
  Username: string;
  Email: string;
  Profile?: { Name: string };
}

export interface ApexLogRecord {
  Id: string;
  Application: string;
  DurationMilliseconds: number;
  Location: string;
  LogLength: number;
  LogUser: { Name: string };
  Operation: string;
  Request: string;
  StartTime: string;
  Status: string;
}

export class SalesforceService {
  async getDefaultOrg(): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync('sf config get target-org --json');
      const parsed = JSON.parse(stdout);
      return parsed?.result?.[0]?.value;
    } catch {
      return undefined;
    }
  }

  /** Recent Apex logs from the org — for the picker. */
  async listRecentLogs(limit = 20, targetOrg?: string): Promise<ApexLogRecord[]> {
    const org = targetOrg || (await this.getDefaultOrg());
    if (!org) {throw new Error('No default Salesforce org found. Run: sf org login web');}

    const soql = `SELECT Id, Application, DurationMilliseconds, Location, LogLength, LogUser.Name, Operation, Request, StartTime, Status FROM ApexLog ORDER BY StartTime DESC LIMIT ${limit}`;
    const { stdout } = await execAsync(
      `sf data query --query "${soql}" --use-tooling-api --target-org ${org} --json`
    );
    const res = JSON.parse(stdout);
    return res?.result?.records ?? [];
  }

  /** Download a log's body to a temp file. Returns the file path. */
  async downloadLog(logId: string, targetOrg?: string): Promise<string> {
    const org = targetOrg || (await this.getDefaultOrg());
    if (!org) {throw new Error('No default Salesforce org found. Run: sf org login web');}

    // sf apex get log outputs the body to stdout
    const { stdout } = await execAsync(
      `sf apex get log --log-id ${logId} --target-org ${org}`,
      { maxBuffer: 50 * 1024 * 1024 } // 50MB in case of huge logs
    );

    // Persist to an OS temp file named with the log ID so filename-extraction picks it up
    const tmpDir = path.join(os.tmpdir(), 'apex-log-analyzer-by-aman');
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, `${logId}.log`);
    fs.writeFileSync(filePath, stdout, 'utf8');
    return filePath;
  }

  async fetchUserForLogId(logId: string, targetOrg?: string): Promise<UserInfo | undefined> {
    const org = targetOrg || (await this.getDefaultOrg());
    if (!org) {throw new Error('No default Salesforce org found. Run: sf org login web');}

    const logSoql = `SELECT LogUserId FROM ApexLog WHERE Id = '${logId}'`;
    const { stdout: logOut } = await execAsync(
      `sf data query --query "${logSoql}" --use-tooling-api --target-org ${org} --json`
    );
    const logRes = JSON.parse(logOut);
    const userId = logRes?.result?.records?.[0]?.LogUserId;
    if (!userId) {return undefined;}

    const userSoql = `SELECT Id, Name, Username, Email, Profile.Name FROM User WHERE Id = '${userId}'`;
    const { stdout: userOut } = await execAsync(
      `sf data query --query "${userSoql}" --target-org ${org} --json`
    );
    const userRes = JSON.parse(userOut);
    return userRes?.result?.records?.[0];
  }

  /** Look for a 07L... ID in the filename. (Body text almost never contains it.) */
  extractLogIdFromFilename(filename: string): string | undefined {
    const base = path.basename(filename);
    const match = /07L[a-zA-Z0-9]{12,15}/.exec(base);
    return match?.[0];
  }
  /** Retrieve an Apex class from the org into the local SFDX project. */
  async retrieveClass(className: string, targetOrg?: string): Promise<void> {
    const org = targetOrg || (await this.getDefaultOrg());
    if (!org) {throw new Error('No default Salesforce org found. Run: sf org login web');}

    // sf project retrieve start --metadata ApexClass:ClassName
    await execAsync(
      `sf project retrieve start --metadata ApexClass:${className} --target-org ${org} --json`,
      { maxBuffer: 10 * 1024 * 1024 }
    );
  }
}