import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface UserInfo {
  Id: string;
  Name: string;
  Username: string;
  Email: string;
  Profile?: { Name: string };
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

  async fetchUserForLogId(logId: string, targetOrg?: string): Promise<UserInfo | undefined> {
    const org = targetOrg || (await this.getDefaultOrg());
    if (!org) throw new Error('No default Salesforce org found. Run: sf org login web');

    const logSoql = `SELECT LogUserId FROM ApexLog WHERE Id = '${logId}'`;
    const { stdout: logOut } = await execAsync(
      `sf data query --query "${logSoql}" --use-tooling-api --target-org ${org} --json`
    );
    const logRes = JSON.parse(logOut);
    const userId = logRes?.result?.records?.[0]?.LogUserId;
    if (!userId) return undefined;

    const userSoql = `SELECT Id, Name, Username, Email, Profile.Name FROM User WHERE Id = '${userId}'`;
    const { stdout: userOut } = await execAsync(
      `sf data query --query "${userSoql}" --target-org ${org} --json`
    );
    const userRes = JSON.parse(userOut);
    return userRes?.result?.records?.[0];
  }

  extractLogIdFromText(text: string): string | undefined {
    const match = /07L[a-zA-Z0-9]{12,15}/.exec(text);
    return match?.[0];
  }
}