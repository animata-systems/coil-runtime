import type {
  OperatorNode, SendNode, ReceiveNode, DefineNode, SetNode,
  ThinkNode, ExecuteNode, EachNode, SignalNode,
  TemplateNode, ValueRef, BodyValue,
} from '../ast/nodes.js';

/** Extract $name refs from a TemplateNode (RefPart entries only). */
export function collectRefsFromTemplate(tmpl: TemplateNode | null): ValueRef[] {
  if (!tmpl) return [];
  const refs: ValueRef[] = [];
  for (const part of tmpl.parts) {
    if (part.type === 'ref') {
      refs.push({ type: 'ref', name: part.name, path: part.path, span: part.span });
    }
  }
  return refs;
}

/** Extract $name refs from a BodyValue (template, ref, or literal). */
export function collectRefsFromBody(body: BodyValue): ValueRef[] {
  if (body.type === 'ref') return [body];
  if (body.type === 'template') return collectRefsFromTemplate(body);
  return []; // string or number literal
}

/**
 * Collect all variable **uses** ($name) from an operator node.
 * Does NOT include definitions (DefineNode.name, ReceiveNode.name, EachNode.element).
 */
export function collectVariableRefs(node: OperatorNode): ValueRef[] {
  const refs: ValueRef[] = [];

  switch (node.kind) {
    case 'Op.Send': {
      const n = node as SendNode;
      refs.push(...collectRefsFromTemplate(n.body));
      break;
    }
    case 'Op.Receive': {
      const n = node as ReceiveNode;
      refs.push(...collectRefsFromTemplate(n.prompt));
      break;
    }
    case 'Op.Define': {
      const n = node as DefineNode;
      refs.push(...collectRefsFromBody(n.body));
      break;
    }
    case 'Op.Set': {
      const n = node as SetNode;
      // target is NOT included — set-without-define owns SET target validation
      refs.push(...collectRefsFromBody(n.body));
      break;
    }
    case 'Op.Think': {
      const n = node as ThinkNode;
      if (n.via) refs.push(n.via);
      for (const a of n.as) refs.push(a);
      refs.push(...collectRefsFromTemplate(n.goal));
      refs.push(...collectRefsFromTemplate(n.input));
      refs.push(...collectRefsFromTemplate(n.context));
      refs.push(...collectRefsFromTemplate(n.body));
      break;
    }
    case 'Op.Execute': {
      const n = node as ExecuteNode;
      for (const arg of n.args) {
        if (arg.value.type === 'ref') refs.push(arg.value);
      }
      break;
    }
    case 'Op.Each': {
      const n = node as EachNode;
      refs.push(n.from); // source is a use; element is a definition — excluded
      break;
    }
    case 'Op.Signal': {
      const n = node as SignalNode;
      refs.push(...collectRefsFromTemplate(n.body));
      break;
    }
  }

  return refs;
}
