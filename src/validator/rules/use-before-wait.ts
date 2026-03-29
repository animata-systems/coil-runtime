import type {
  ScriptNode, OperatorNode, CommentNode,
  DefineNode, ReceiveNode, ThinkNode, ExecuteNode, SendNode, WaitNode,
  EachNode, IfNode, RepeatNode,
} from '../../ast/nodes.js';
import type { ScopeModel } from '../scope.js';
import type { DialectTable } from '../../dialect/types.js';
import type { ValidationDiagnostic, ValidationRule } from '../validator.js';
import { collectVariableRefs } from '../refs.js';
import { formatMessage } from '../messages.js';

type VarState = 'defined' | 'promised';

/**
 * Positional rule (D-007-6): walks AST with incremental scope.
 * Reports info when $name is used while still in 'promised' state.
 */
export const useBeforeWait: ValidationRule = {
  ruleId: 'use-before-wait',
  run(ast: ScriptNode, _scope: ScopeModel, dialect: DialectTable): ValidationDiagnostic[] {
    const diagnostics: ValidationDiagnostic[] = [];
    const vars = new Map<string, VarState>();
    const reported = new Set<string>();

    function walkNodes(nodes: ReadonlyArray<OperatorNode | CommentNode>): void {
      for (const node of nodes) {
        if (node.kind === 'Comment') continue;
        const op = node as OperatorNode;

        // 1. Check uses BEFORE updating scope
        const refs = collectVariableRefs(op);
        for (const ref of refs) {
          if (reported.has(ref.name)) continue;
          const state = vars.get(ref.name);
          if (state === 'promised') {
            reported.add(ref.name);
            diagnostics.push({
              severity: 'info',
              ruleId: 'use-before-wait',
              message: formatMessage('use-before-wait', dialect, ref.name),
              span: ref.span,
            });
          }
        }

        // 2. Update incremental scope
        switch (op.kind) {
          case 'Op.Define': {
            const n = op as DefineNode;
            vars.set(n.name, 'defined');
            break;
          }
          case 'Op.Receive': {
            const n = op as ReceiveNode;
            vars.set(n.name, 'defined');
            break;
          }
          case 'Op.Think': {
            const n = op as ThinkNode;
            if (n.name) vars.set(n.name, 'promised');
            break;
          }
          case 'Op.Execute': {
            const n = op as ExecuteNode;
            if (n.name) vars.set(n.name, 'promised');
            break;
          }
          case 'Op.Send': {
            const n = op as SendNode;
            if (n.name) vars.set(n.name, 'promised');
            break;
          }
          case 'Op.Wait': {
            const n = op as WaitNode;
            for (const ref of n.on) {
              if (vars.get(ref.name) === 'promised') {
                vars.set(ref.name, 'defined');
              }
            }
            if (n.name) {
              vars.set(n.name, 'defined');
            }
            break;
          }
          case 'Op.Each': {
            const n = op as EachNode;
            vars.set(n.element.name, 'defined');
            walkNodes(n.body);
            break;
          }
          case 'Op.If': {
            const n = op as IfNode;
            walkNodes(n.body);
            break;
          }
          case 'Op.Repeat': {
            const n = op as RepeatNode;
            walkNodes(n.body);
            break;
          }
        }
      }
    }

    walkNodes(ast.nodes);
    return diagnostics;
  },
};
