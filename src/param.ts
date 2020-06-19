export type ParamContext = {
  values: Record<string, any>;
};

export const emptyContext: ParamContext = { values: {} };

export type Param<T> = { key: string; options: readonly T[]; __type: T };

export function param<T>(name: string, options: readonly T[]): Param<T> {
  return { key: name, options } as Param<T>;
}
export function loadParam<T>(context: ParamContext, param: Param<T>): T {
  if (param.key in context.values) {
    return context.values[param.key];
  }
  throw new ParamMissingError(context, param);
}

export class ParamMissingError extends Error {
  constructor(public readonly context: ParamContext, public readonly param: Param<any>) {
    super(`missing param assignment for '${param.key}'`);
  }
}
