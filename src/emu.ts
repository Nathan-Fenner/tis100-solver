export const MAX_INSTRS = 4;

type Port = "LEFT" | "RIGHT" | "UP" | "DOWN";

type Interaction<Value> = {
  recv: (port: Port) => Value;
  send: (port: Port, value: Value) => void;
};

// used to prune search space, by skipping redundant programs
export class RedundancyError extends Error {}

export function emulateNode<Value>(
  program: {
    op: (pc: number) => "ADD" | "SUB" | "MOV" | "NOP" | "NEG" | "SAV" | "SWP";
    src: (pc: number) => Port | "ACC" | "sym";
    dst: (pc: number) => Port | "ACC" | "NIL";
  },
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

  function recv(src: "sym" | "ACC" | Port, pc: number): Value {
    if (src === "ACC") {
      return acc;
    }
    if (src === "sym") {
      return arithmetic.symbol(`${pc}:`);
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

    const op = program.op(pc);
    ({
      ADD: () => {
        const from = recv(program.src(pc), pc);
        acc = arithmetic.add(acc, from);
      },
      SUB: () => {
        const from = recv(program.src(pc), pc);
        acc = arithmetic.add(acc, arithmetic.neg(from));
      },
      MOV: () => {
        const from = recv(program.src(pc), pc);
        send(program.dst(pc), from);

        // sanity check for pointless programs:
        if (program.dst(pc) === "NIL") {
          const read = program.src(pc);
          if (typeof read === "number" || read === "ACC") {
            // Pointless operation; use NOP instead.
            throw new RedundancyError();
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
