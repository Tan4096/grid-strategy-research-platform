export function humanizeConstraint(code: string): string {
  if (!code) {
    return "未知约束";
  }
  if (code.startsWith("train_trades<")) {
    return `训练期交易数不足（要求 ${code.split("<")[1]}）`;
  }
  if (code.startsWith("validation_trades<")) {
    return `验证期交易数不足（要求 ${code.split("<")[1]}）`;
  }
  if (code.startsWith("train_drawdown>")) {
    return `训练期回撤超限（上限 ${code.split(">")[1]}%）`;
  }
  if (code.startsWith("validation_drawdown>")) {
    return `验证期回撤超限（上限 ${code.split(">")[1]}%）`;
  }
  if (code === "train_return<=0") {
    return "训练期收益非正";
  }
  if (code === "validation_return<=0") {
    return "验证期收益非正";
  }
  return code;
}

export function humanizeConstraintList(codes: string[]): string[] {
  return codes.map(humanizeConstraint);
}
