// an interpreter and search system for TIS-100 programs

const MAX_INSTRS = 3;

type ParamContext = {
  values: Record<string, any>;
};

const emptyContext: ParamContext = { values: {} };

type Param<T> = { key: string; options: readonly T[]; __type: T };

function param<T>(name: string, options: readonly T[]): Param<T> {
  return { key: name, options } as Param<T>;
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

class ParamMissingError extends Error {
  constructor(public readonly context: ParamContext, public readonly param: Param<any>) {
    super(`missing param assignment for '${param.key}'`);
  }
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

function loadParam<T>(context: ParamContext, param: Param<T>): T {
  if (param.key in context.values) {
    return context.values[param.key];
  }
  throw new ParamMissingError(context, param);
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

type Port = "LEFT" | "RIGHT" | "UP" | "DOWN";

type Interaction<Value> = {
  recv: (port: Port) => Value;
  send: (port: Port, value: Value) => void;
};

function emulateNode<Value>(
  program: ParamContext,
  report: (state: string) => void,
  interaction: Interaction<Value>,
  arithmetic: {
    zero: Value;
    add: (a: Value, b: Value) => Value;
    neg: (a: Value) => Value;
    symbol: (name: string) => Value;
  },
) {
  let pc = 0;
  let acc = arithmetic.zero;
  let bak = arithmetic.zero;

  function recv(src: "sym" | "ACC" | Port, place: string): Value {
    if (src === "ACC") {
      return acc;
    }
    if (src === "sym") {
      return arithmetic.symbol(place);
    }
    return interaction.recv(src);
  }

  function send(dst: "NIL" | "ACC" | Port, value: Value): void {
    if (dst === "NIL") {
      return;
    }
    if (dst === "ACC") {
      acc = value;
      return;
    }
    interaction.send(dst, value);
  }

  while (true) {
    report(JSON.stringify([pc, acc, bak]));

    const instructionLocation = `node00:${pc}`;

    const op = loadParam(program, paramOp(instructionLocation));
    ({
      ADD: () => {
        const from = recv(loadParam(program, argRead(instructionLocation)), instructionLocation);
        acc = arithmetic.add(acc, from);
      },
      SUB: () => {
        const from = recv(loadParam(program, argRead(instructionLocation)), instructionLocation);
        acc = arithmetic.add(acc, arithmetic.neg(from));
      },
      MOV: () => {
        const from = recv(loadParam(program, argRead(instructionLocation)), instructionLocation);
        send(loadParam(program, argWrite(instructionLocation)), from);

        // sanity check for pointless programs:
        if (loadParam(program, argWrite(instructionLocation)) === "NIL") {
          const read = loadParam(program, argRead(instructionLocation));
          if (typeof read === "number" || read === "ACC") {
            // Pointless operation; use NOP instead.
            throw new StateViolationError();
          }
        }
      },
      NEG: () => {
        acc = arithmetic.neg(acc);
      },
      SWP: () => {
        [acc, bak] = [bak, acc];
      },
      SAV: () => {
        bak = acc;
      },
      NOP: () => {
        // nothing
      },
    }[op]());

    pc++;
    pc %= MAX_INSTRS;
  }
}

// attempt to search for programs!

function nice(program: ParamContext) {
  let s = "";
  for (let pc = 0; pc < MAX_INSTRS; pc++) {
    s += `${pc}: `;
    const instructionLocation = `node00:${pc}`;
    try {
      const op = loadParam(program, paramOp(instructionLocation));
      s += op;
      s += " ";
      if (op === "ADD" || op === "SUB") {
        s += loadParam(program, argRead(instructionLocation));
      }
      if (op === "MOV") {
        s += loadParam(program, argRead(instructionLocation));
        s += " ";
        s += loadParam(program, argWrite(instructionLocation));
      }
    } catch (err) {
      s += "???";
    }
    s += "\n";
  }
  return s;
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
          context,
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
        if (err instanceof StateViolationError) {
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
      console.info(nice(context));
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
