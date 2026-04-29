// Hand-crafted minimal Apex log fixtures used by the unit tests.
// Each fixture isolates one specific behaviour we want to assert on.

export const NORMAL_LOG = [
  "52.0 APEX_CODE,DEBUG;APEX_PROFILING,INFO;",
  "12:00:00.000 (1000000)|EXECUTION_STARTED",
  "12:00:00.000 (1100000)|CODE_UNIT_STARTED|[EXTERNAL]|MyClass.run",
  "12:00:00.000 (1200000)|METHOD_ENTRY|[10]|01p000000000000|MyClass.foo()",
  "12:00:00.000 (1500000)|SOQL_EXECUTE_BEGIN|[12]|Aggregations:0|SELECT Id FROM Account",
  "12:00:00.000 (1700000)|SOQL_EXECUTE_END|[12]|Rows:5",
  "12:00:00.000 (1800000)|METHOD_EXIT|[10]|01p000000000000|MyClass.foo()",
  "12:00:00.000 (1900000)|CODE_UNIT_FINISHED|MyClass.run",
  "12:00:00.000 (2000000)|EXECUTION_FINISHED",
].join("\n");

export const SOQL_IN_LOOP_LOG = [
  "52.0 APEX_CODE,DEBUG;",
  "12:00:00.000 (1000000)|EXECUTION_STARTED",
  ...Array.from({ length: 7 }, (_, i) => {
    const t = 1100000 + i * 100000;
    return [
      `12:00:00.000 (${t})|SOQL_EXECUTE_BEGIN|[20]|Aggregations:0|SELECT Id FROM Contact WHERE AccountId = :accId`,
      `12:00:00.000 (${t + 50000})|SOQL_EXECUTE_END|[20]|Rows:1`,
    ].join("\n");
  }),
  "12:00:00.000 (2000000)|EXECUTION_FINISHED",
].join("\n");

export const FATAL_ERROR_LOG = [
  "52.0 APEX_CODE,DEBUG;",
  "12:00:00.000 (1000000)|EXECUTION_STARTED",
  "12:00:00.000 (1100000)|FATAL_ERROR|System.NullPointerException: Attempt to de-reference a null object",
  "",
  "Class.AccountService.process: line 105, column 1",
  "Class.AccountTrigger.handle: line 42, column 1",
  "Trigger.AccountTrigger: line 12, column 1",
  "12:00:00.000 (1200000)|EXECUTION_FINISHED",
].join("\n");

export const LIMITS_LOG = [
  "52.0 APEX_CODE,DEBUG;",
  "12:00:00.000 (1000000)|EXECUTION_STARTED",
  "12:00:00.000 (1100000)|CUMULATIVE_LIMIT_USAGE",
  "12:00:00.000 (1101000)|LIMIT_USAGE_FOR_NS|(default)|",
  "  Number of SOQL queries: 50 out of 100",
  "  Number of query rows: 1000 out of 50000",
  "  Number of SOSL queries: 0 out of 20",
  "  Number of DML statements: 130 out of 150",
  "  Number of DML rows: 200 out of 10000",
  "  Maximum CPU time: 8500 out of 10000",
  "  Maximum heap size: 1000 out of 6000000",
  "  Number of callouts: 0 out of 100",
  "12:00:00.000 (2000000)|EXECUTION_FINISHED",
].join("\n");

export const TEST_RESULTS_LOG = [
  "52.0 APEX_CODE,DEBUG;",
  "12:00:00.000 (1000000)|EXECUTION_STARTED",
  "12:00:00.000 (1100000)|TEST_PASS|MyTestClass.testFoo|0",
  "12:00:00.000 (1200000)|TEST_FAIL|MyTestClass.testBar|System.AssertException: Expected: foo, Actual: bar",
  "12:00:00.000 (1300000)|TEST_PASS|MyTestClass.testBaz|0",
  "12:00:00.000 (2000000)|EXECUTION_FINISHED",
].join("\n");

export const LARGE_QUERY_LOG = [
  "52.0 APEX_CODE,DEBUG;",
  "12:00:00.000 (1000000)|EXECUTION_STARTED",
  "12:00:00.000 (1100000)|SOQL_EXECUTE_BEGIN|[15]|Aggregations:0|SELECT Id FROM Account",
  "12:00:00.000 (1200000)|SOQL_EXECUTE_END|[15]|Rows:2500",
  "12:00:00.000 (2000000)|EXECUTION_FINISHED",
].join("\n");
