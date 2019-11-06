import * as vscode from "vscode";
import { config } from "./extension";
import { LanguageClient } from "vscode-languageclient/lib/main";

export class DubTasksProvider implements vscode.TaskProvider {
	constructor(public served: LanguageClient) { }

	provideTasks(token?: vscode.CancellationToken | undefined): vscode.ProviderResult<vscode.Task[]> {
		let dubLint = config(null).get("enableDubLinting", true);
		return this.served.sendRequest<{
			definition: any,
			scope: string,
			exec: string[],
			name: string,
			isBackground: boolean,
			source: string,
			group: "clean" | "build" | "rebuild" | "test",
			problemMatchers: string[]
		}[]>("served/buildTasks").then(tasks => {
			var ret: vscode.Task[] = [];
			tasks.forEach(task => {
				var target: vscode.WorkspaceFolder | vscode.TaskScope | undefined;
				let cwd: string = "";
				if (task.scope == "global")
					target = vscode.TaskScope.Global;
				else if (task.scope == "workspace")
					target = vscode.TaskScope.Workspace;
				else {
					let uri = vscode.Uri.parse(task.scope);
					cwd = uri.fsPath;
					target = vscode.workspace.getWorkspaceFolder(uri);
				}
				if (!target)
					return undefined;
				var proc: string = task.exec.shift() || "exit";
				var args: string[] = task.exec;

				task.source += "-auto";
				// workaround to weird behavior that vscode seems to ignore build tasks if the same as user task definition
				task.definition._generated = true;

				let options: vscode.ShellExecutionOptions | undefined = cwd ? { cwd: cwd } : undefined;

				if (!dubLint && !Array.isArray(task.problemMatchers) || task.problemMatchers.length == 0)
					task.problemMatchers = ["$dmd"];

				var t = new vscode.Task(
					task.definition, target, task.name, task.source,
					new vscode.ShellExecution({
						value: proc,
						quoting: vscode.ShellQuoting.Strong
					}, args.map(arg => <vscode.ShellQuotedString>{
						value: arg,
						quoting: vscode.ShellQuoting.Strong
					}), options),
					task.problemMatchers);
				t.isBackground = task.isBackground;
				switch (task.group) {
					case "clean":
						t.group = vscode.TaskGroup.Clean;
						break;
					case "build":
						t.group = vscode.TaskGroup.Build;
						break;
					case "rebuild":
						t.group = vscode.TaskGroup.Rebuild;
						break;
					case "test":
						t.group = vscode.TaskGroup.Test;
						break;
				}
				ret.push(t);
			});
			return ret;
		});
	}

	resolveTask(task: vscode.Task & {
		definition: {
			run?: boolean,
			test?: boolean,
			root?: string,
			cwd?: string,
			overrides?: string[],
			force?: boolean,
			compiler?: string,
			archType?: string,
			buildType?: string,
			configuration?: string,
			args?: string[]
		}
	}, token?: vscode.CancellationToken | undefined): vscode.ProviderResult<vscode.Task> {
		let dubLint = config(null).get("enableDubLinting", true);
		var args: string[] = [config(null).get("dubPath", "dub")];
		args.push(task.definition.test ? "test" : task.definition.run ? "run" : "build");
		if (task.definition.root)
			args.push("--root=" + task.definition.root);
		if (task.definition.overrides)
			task.definition.overrides.forEach(override => {
				args.push("--override-config=" + override);
			});
		if (task.definition.force)
			args.push("--force");
		if (task.definition.compiler)
			args.push("--compiler=" + task.definition.compiler);
		if (task.definition.archType)
			args.push("--arch=" + task.definition.archType);
		if (task.definition.buildType)
			args.push("--build=" + task.definition.buildType);
		if (task.definition.configuration)
			args.push("--config=" + task.definition.configuration);
		if (Array.isArray(task.definition.args))
			args.push.apply(args, task.definition.args);

		let options: any = task.scope && (<vscode.WorkspaceFolder>task.scope).uri;
		options = options ? <vscode.ShellExecutionOptions>{ cwd: options.fsPath } : undefined;

		if (task.definition.cwd)
			options = <vscode.ShellExecutionOptions>{ cwd: task.definition.cwd };

		let exec = new vscode.ShellExecution({
			value: args.shift() || "exit",
			quoting: vscode.ShellQuoting.Strong
		}, args.map(arg => <vscode.ShellQuotedString>{
			value: arg,
			quoting: vscode.ShellQuoting.Strong
		}), options);

		return new vscode.Task(
			task.definition,
			task.scope || vscode.TaskScope.Global,
			task.name || `dub ${task.definition.test ? "Test" : task.definition.run ? "Run" : "Build"}`,
			"dub", exec, dubLint ? task.problemMatchers : ["$dmd"]
		);
	}
}