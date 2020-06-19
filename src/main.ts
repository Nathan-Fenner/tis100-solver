// an interpreter and search system for TIS-100 programs

import { emulateNode, MAX_INSTRS, RedundancyError } from "./emu";
import { param, loadParam, ParamContext, ParamMissingError, Param, emptyContext } from "./param";

function serializeProgram(program: ParamContext) {
  let s = "";
  for (let pc = 0; pc < MAX_INSTRS; pc++) {
    s += `${pc}: `;
    const location = `${pc}:`;
    try {
      const op = loadParam(program, paramOp(location));
      s += op;
      s += " ";
      if (op === "ADD" || op === "SUB") {
        s += loadParam(program, argRead(location));
      }
      if (op === "MOV") {
        s += loadParam(program, argRead(location));
        s += " ";
        s += loadParam(program, argWrite(location));
      }
    } catch (err) {
      s += "???";
    }
    s += "\n";
  }
  return s;
}

function argRead(name: string) {
  return param(`read-arg-${name}`, ["UP", "LEFT", "RIGHT", "DOWN", "ACC", "sym"] as const);
}

function argWrite(name: string) {
  return param(`write-arg-${name}`, ["UP", "LEFT", "RIGHT", "DOWN", "ACC", "NIL"] as const);
}

function paramOp(name: string) {
  return param(`op-${name}`, ["ADD", "SUB", "MOV", "NEG", "SWP", "SAV", "NOP"] as const);
}

function constantParam(name: string) {
  return param(`const-${name}`, [0, 2] as const);
}

class StateViolationError extends Error {
  constructor() {
    super("node entered illegal state; program is invalid");
  }
}
class StuckError extends Error {
  constructor() {
    super("node is stuck (e.g. waiting for input)");
  }
}
class DoneError extends Error {
  constructor() {
    super("node is done, so it cannot continue");
  }
}

function assignParam<T>(context: ParamContext, param: Param<T>, value: T): ParamContext {
  if (param.key in context.values) {
    throw new Error(`param key '${param.key}' was already assigned`);
  }
  return {
    values: { ...context.values, [param.key]: value },
  };
}
function bifurcateParam<T>(context: ParamContext, param: Param<T>): ParamContext[] {
  return param.options.map((option) => assignParam(context, param, option));
}

function solve(scenarios: { input: number[]; output: number[] }[]) {
  const search: ParamContext[] = [emptyContext];
  let workCount = 0;
  while (search.length > 0) {
    workCount++;
    const context = search.pop()!;

    // run the program:
    let bifurcation: Param<any> | null = null;
    let violation = false;
    let doneCount = 0;

    const targetable = new Map<string, string>();

    for (const scenario of scenarios) {
      try {
        let inputCounter = 0;
        let outputCounter = 0;
        const encounters = new Set<string>();
        emulateNode(
          {
            op: (pc: number) => loadParam(context, paramOp(`${pc}:`)),
            src: (pc: number) => loadParam(context, argRead(`${pc}:`)),
            dst: (pc: number) => loadParam(context, argWrite(`${pc}:`)),
          },
          (report) => {
            const fullReport = `${report};${inputCounter};${outputCounter}`;
            if (encounters.has(fullReport)) {
              // infinite loop
              throw new StateViolationError();
            }
            encounters.add(fullReport);

            const target = scenario.output.slice(outputCounter).join(";");
            const detailState = `${scenario.input.slice(inputCounter).join(";")} -> ${report}`;
            if (targetable.has(detailState) && targetable.get(detailState)! !== target) {
              // Two different programs with the same state prefix
              // (same code, same input left, same program counter, same ACC, same BAK)
              // need to behave differently!
              // Hence, the program is buggy.
              // Note that this analysis continues across executions for the same program.
              // More (short input) scenarios make it more effective. Long input sequences
              // will tend to be different, preventing collisions that allow detection of
              // buggy programs.
              throw new StateViolationError();
            }
            targetable.set(detailState, target);
          },
          {
            recv: (port) => {
              if (port !== "UP") {
                throw new StateViolationError();
              }
              if (inputCounter >= scenario.input.length) {
                throw new StuckError();
              }
              const result = scenario.input[inputCounter];
              inputCounter += 1;
              return result;
            },
            send: (port, value) => {
              if (port !== "DOWN") {
                throw new StateViolationError();
              }
              if (outputCounter >= scenario.output.length) {
                // TODO: we should just accept it and do nothing, maybe?
                throw new Error("unreachable");
              }
              if (value !== scenario.output[outputCounter]) {
                // sent the wrong value
                throw new StateViolationError();
              }
              outputCounter += 1;
              if (outputCounter >= scenario.output.length) {
                throw new DoneError();
              }
            },
          },
          {
            add: (a: number, b: number): number => {
              const v = a + b;
              if (v > 999 || v < -999) {
                throw new StateViolationError();
              }
              return v;
            },
            neg: (a: number): number => {
              return -a;
            },
            zero: 0,
            symbol: (place: string) => {
              return loadParam(context, constantParam(place));
            },
          },
        );
      } catch (err) {
        if (err instanceof StateViolationError || err instanceof RedundancyError) {
          // no need to consider branches
          violation = true;
          break;
        }
        if (err instanceof ParamMissingError) {
          bifurcation = err.param;
          continue;
        }
        if (err instanceof DoneError) {
          doneCount++;
          continue;
        }
        if (err instanceof StuckError) {
          // TODO: should this be handled differently than other violations?
          violation = true;
          break;
        }
        throw err;
      }
    }

    if (doneCount === scenarios.length) {
      console.info(serializeProgram(context));
      console.info("success!");
      console.info("checked", workCount);
      console.info("search stack", search.length);
      break;
    }

    if (violation) {
      // buggy programs can be skipped.
      continue;
    }
    if (!bifurcation) {
      console.info("unexpected: no split?");
      continue;
    }

    search.push(...bifurcateParam(context, bifurcation));
  }
}
solve([
  { input: [0, 1], output: [1, 0] },
  { input: [1, 2], output: [2, 1] },
  { input: [4, 2], output: [2, 4] },
  { input: [5, 1], output: [1, 5] },
]);
