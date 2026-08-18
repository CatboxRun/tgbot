/**
 * 去掉「节点 DApp / Liminal Nodes」产品向内容（该模块已结束，客服不体现）。
 * 保留技术语境中的「节点」（如 RPC 节点、Dandelion 转发节点）。
 */
export function scrubNodesProduct(text) {
  if (!text) return '';
  let t = String(text);

  // 整段产品模块
  t = t.replace(/2\.2\.3\s*Liminal\s*Nodes[\s\S]*?(?=2\.2\.4|2\.3|第\s*三\s*章)/gi, '\n');
  t = t.replace(/2\.2\.3\s*Liminal\s*Nodes:[\s\S]*?(?=2\.2\.4|2\.3|Chapter\s*3)/gi, '\n');
  t = t.replace(/3\.6\s*Node\s*Economy[\s\S]*?(?=3\.7|第\s*四\s*章|Chapter\s*4)/gi, '\n');
  t = t.replace(/5\.3\.3\s*节点奖励抛售风险[\s\S]*?(?=5\.3\.4|5\.4)/gi, '\n');
  t = t.replace(/Appendix\s*C:[\s\S]*?Node[\s\S]*?(?=Appendix\s*D|$)/gi, '\n');
  t = t.replace(/C\.2\s*Node\s*Promotion[\s\S]*?(?=C\.3|Appendix|$)/gi, '\n');

  // FAQ：C3 Nodes 操作整章、B06/B07
  t = t.replace(/C3\.\s*Liminal\s*Nodes[\s\S]*?(?=四、\s*板\s*块\s*D|板\s*块\s*D:|D01\.)/gi, '\n');
  t = t.replace(/B06\.\s*节\s*点[\s\S]*?(?=B08\.)/gi, '\n');
  t = t.replace(/B06\.\s*节点[\s\S]*?(?=B08\.)/gi, '\n');
  t = t.replace(/B07\.\s*节点[\s\S]*?(?=B08\.)/gi, '\n');
  t = t.replace(/D05\.\s*节点奖励[\s\S]*?(?=D06\.|E0|五、)/gi, '\n');

  // 角色介绍里的「节点共建者」整段
  t = t.replace(/成为节点共建者[\s\S]{0,200}/gi, '');
  t = t.replace(/节点共建者（Nodes）[\s\S]{0,200}/gi, '');
  t = t.replace(/限量\s*1180\s*个[^\n。]{0,120}/gi, '');
  t = t.replace(/1180\s*个\s*合伙\s*人\s*节点[^\n。]{0,80}/gi, '');
  t = t.replace(/1180\s*个[^\n。]{0,40}/gi, '');
  t = t.replace(/使用者[^\n]*节点共建者[^\n]*/gi, '使用者可通过隐私网关匿名转账；流动性供给者可将 USDT 存入隐私池。');
  t = t.replace(/三方围绕同一隐私池协作[^\n。]*/gi, '各方围绕同一隐私池协作，让匿名性变为可定价、可供给、可激励的稀缺资产');

  // 托管最低额：旧材料 500 → 现行 50
  t = t.replace(/最低\s*500\s*USDT/gi, '最低 50 USDT');
  t = t.replace(/最\s*低\s*500\s*USDT/gi, '最低 50 USDT');
  t = t.replace(/最低存入\s*500/gi, '最低存入 50');
  t = t.replace(/minimum\s+is\s+500\s+USDT/gi, 'minimum is 50 USDT');
  t = t.replace(/minimum\s+deposit[^\n.]{0,20}500\s+USDT/gi, 'minimum deposit 50 USDT');
  t = t.replace(/管\s*金额\s*\(\s*最\s*低\s*500\s*USDT\s*\)/gi, '管金额（最低 50 USDT）');
  t = t.replace(/\(最\s*低\s*500\s*USDT\)/gi, '（最低 50 USDT）');

  // 分配表述弱化「可认购节点」语感，保留历史比例时可简述但不作入口
  t = t.replace(/节点\s*1%\s*10,000,000\s*1000\s*个节点认购[^。\n]*/gi, '历史节点额度 1%（模块已结束，客服不展开）');
  t = t.replace(/分配：生态\s*90%、节点\s*1%/g, '分配：生态 90%、历史节点额度 1%（已结束）');

  return t.replace(/\n{3,}/g, '\n\n').trim();
}
