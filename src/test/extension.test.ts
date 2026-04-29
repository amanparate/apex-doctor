import * as assert from "assert";
import { ApexLogParser } from "../parser";
import { ApexDoctor } from "../analyzer";
import { CompareService } from "../compareService";
import {
  NORMAL_LOG,
  SOQL_IN_LOOP_LOG,
  FATAL_ERROR_LOG,
  LIMITS_LOG,
  TEST_RESULTS_LOG,
  LARGE_QUERY_LOG,
} from "./fixtures";

const parser = new ApexLogParser();
const doctor = new ApexDoctor();

suite("ApexLogParser", () => {
  test("parses API version + log levels from header", () => {
    const out = parser.parse(NORMAL_LOG);
    assert.strictEqual(out.apiVersion, "52.0");
    assert.strictEqual(out.logLevels.APEX_CODE, "DEBUG");
    assert.strictEqual(out.logLevels.APEX_PROFILING, "INFO");
  });

  test("extracts event types and Apex line numbers", () => {
    const out = parser.parse(NORMAL_LOG);
    const types = out.events.map((e) => e.eventType);
    assert.ok(types.includes("EXECUTION_STARTED"));
    assert.ok(types.includes("METHOD_ENTRY"));
    assert.ok(types.includes("SOQL_EXECUTE_BEGIN"));
    const methodEntry = out.events.find((e) => e.eventType === "METHOD_ENTRY");
    assert.strictEqual(methodEntry?.lineNumber, 10);
  });

  test("appends continuation lines onto the last event's details", () => {
    const out = parser.parse(FATAL_ERROR_LOG);
    const fatal = out.events.find((e) => e.eventType === "FATAL_ERROR");
    assert.ok(fatal);
    assert.match(fatal!.details, /Class\.AccountService\.process: line 105/);
    assert.match(fatal!.details, /Trigger\.AccountTrigger: line 12/);
  });
});

suite("ApexDoctor.analyze", () => {
  test("normal log → no issues, captures soql + method timing", () => {
    const a = doctor.analyze(parser.parse(NORMAL_LOG));
    assert.strictEqual(a.issues.length, 0);
    assert.strictEqual(a.soql.length, 1);
    assert.strictEqual(a.soql[0].rows, 5);
    assert.strictEqual(a.methods.length, 1);
    assert.ok(a.summary.totalDurationMs > 0);
  });

  test("detects SOQL-in-loop above threshold (default 5)", () => {
    const a = doctor.analyze(parser.parse(SOQL_IN_LOOP_LOG));
    const inLoop = a.issues.find((i) => i.type === "SOQL in Loop");
    assert.ok(inLoop, "expected SOQL in Loop issue");
    assert.strictEqual(inLoop!.severity, "error");
    assert.match(inLoop!.message, /7 times/);
  });

  test("flags large query results when rows >= largeQueryThreshold", () => {
    const a = doctor.analyze(parser.parse(LARGE_QUERY_LOG));
    const large = a.issues.find((i) => i.type === "Large Query Result");
    assert.ok(large, "expected Large Query Result issue");
    assert.match(large!.message, /2500 rows/);
  });

  test("parses governor limits into structured metrics", () => {
    const a = doctor.analyze(parser.parse(LIMITS_LOG));
    assert.strictEqual(a.limits.length, 1);
    const lu = a.limits[0];
    assert.strictEqual(lu.namespace, "(default)");
    const cpu = lu.metrics.find((m) => m.name === "CPU time");
    assert.ok(cpu, "expected CPU time metric");
    assert.strictEqual(cpu!.used, 8500);
    assert.strictEqual(cpu!.limit, 10000);
    assert.ok(cpu!.pct >= 84 && cpu!.pct <= 86);
    const dml = lu.metrics.find((m) => m.name === "DML statements");
    assert.ok(dml);
    assert.strictEqual(dml!.used, 130);
  });

  test("parses Apex stack frames out of FATAL_ERROR details", () => {
    const a = doctor.analyze(parser.parse(FATAL_ERROR_LOG));
    const fatal = a.issues.find((i) => i.type === "Fatal Error");
    assert.ok(fatal, "expected Fatal Error issue");
    assert.ok(fatal!.stackFrames && fatal!.stackFrames.length >= 3);
    const top = fatal!.stackFrames![0];
    assert.strictEqual(top.className, "AccountService");
    assert.strictEqual(top.methodName, "process");
    assert.strictEqual(top.line, 105);
  });

  test("captures TEST_PASS / TEST_FAIL events as testResults", () => {
    const a = doctor.analyze(parser.parse(TEST_RESULTS_LOG));
    assert.strictEqual(a.testResults.length, 3);
    const failed = a.testResults.filter((t) => !t.passed);
    assert.strictEqual(failed.length, 1);
    assert.strictEqual(failed[0].name, "MyTestClass.testBar");
    const failIssue = a.issues.find((i) => i.type === "Test Failed");
    assert.ok(failIssue, "expected a Test Failed issue alongside the result");
  });

  test("computes performance insights (deterministic rules)", () => {
    const a = doctor.analyze(parser.parse(NORMAL_LOG));
    assert.ok(a.insights.length > 0);
    const breakdown = a.insights.find((i) => i.title === "Time breakdown");
    assert.ok(breakdown, "expected a 'Time breakdown' insight");
  });
});

suite("CompareService", () => {
  test("aggregates method timing across calls (sum, not max)", () => {
    const compare = new CompareService();
    const baseline = doctor.analyze(parser.parse(NORMAL_LOG));
    const comparison = doctor.analyze(parser.parse(NORMAL_LOG));
    const result = compare.compare(baseline, comparison, "A", "B");
    const fooDelta = result.methods.find((m) => m.name.includes("foo"));
    assert.ok(fooDelta);
    assert.strictEqual(fooDelta!.baselineCalls, 1);
    assert.strictEqual(fooDelta!.comparisonCalls, 1);
    assert.strictEqual(fooDelta!.callsDelta, 0);
  });

  test("verdict reports equivalent runs as 'equivalent'", () => {
    const compare = new CompareService();
    const baseline = doctor.analyze(parser.parse(NORMAL_LOG));
    const comparison = doctor.analyze(parser.parse(NORMAL_LOG));
    const result = compare.compare(baseline, comparison, "A", "B");
    assert.strictEqual(result.summary.verdict, "equivalent");
  });
});
