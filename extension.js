"use strict";
/**
 * Code-Comment Generator — VS Code extension
 *
 * Sends the user's selected code to a model server and inserts the generated
 * comment above the selection.
 *
 * Improvements over the 2022 version:
 *   - Server URL is configurable via VS Code settings (no more editing the
 *     extension every time the ngrok URL rotates).
 *   - No destructive lowercasing — Java is case-sensitive and `getName` and
 *     `getname` are different methods.
 *   - Proper error handling — network failures show a friendly message rather
 *     than failing silently.
 *   - Loading indicator while the request is in flight.
 *   - Comment formatted as a Javadoc block (`/** ... *​/`) instead of a
 *     trailing `//` line, which is the convention for Java methods.
 */

const vscode = require("vscode");
const axios = require("axios");

const COMMAND_ID = "code-commenter.generate";
const CONFIG_SECTION = "codeCommenter";

function getServerUrl() {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return config.get("serverUrl", "http://localhost:8000/generate");
}

function getRequestTimeout() {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return config.get("timeoutMs", 30000);
}

function formatAsJavadoc(comment, indent) {
    // Wrap text at ~80 chars, keep formatting simple
    const lines = [];
    const words = comment.split(/\s+/);
    let current = "";
    for (const word of words) {
        if ((current + " " + word).length > 76) {
            lines.push(current);
            current = word;
        } else {
            current = current ? current + " " + word : word;
        }
    }
    if (current) lines.push(current);

    const out = [`${indent}/**`];
    for (const line of lines) {
        out.push(`${indent} * ${line}`);
    }
    out.push(`${indent} */`);
    return out.join("\n") + "\n";
}

async function generateComment() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage("Open a file and select some code first.");
        return;
    }

    const selection = editor.selection;
    const code = editor.document.getText(selection);
    if (!code || code.trim().length === 0) {
        vscode.window.showWarningMessage("Select the code you want to comment.");
        return;
    }

    // Detect indentation of the line where the selection starts
    const startLine = editor.document.lineAt(selection.start.line);
    const indentMatch = startLine.text.match(/^\s*/);
    const indent = indentMatch ? indentMatch[0] : "";

    const serverUrl = getServerUrl();
    const timeoutMs = getRequestTimeout();

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Generating comment...",
            cancellable: false,
        },
        async () => {
            try {
                const response = await axios.post(
                    serverUrl,
                    { code: code },
                    {
                        headers: { "Content-Type": "application/json" },
                        timeout: timeoutMs,
                    }
                );

                const comment = response.data.comment || response.data;
                if (!comment || typeof comment !== "string") {
                    throw new Error("Server returned an unexpected response format.");
                }

                const javadoc = formatAsJavadoc(comment, indent);
                await editor.edit((editBuilder) => {
                    const insertPos = new vscode.Position(selection.start.line, 0);
                    editBuilder.insert(insertPos, javadoc);
                });
                vscode.window.showInformationMessage("Comment inserted.");
            } catch (err) {
                let msg = "Failed to generate comment.";
                if (err.code === "ECONNREFUSED") {
                    msg = `Cannot reach the model server at ${serverUrl}. Is it running?`;
                } else if (err.code === "ECONNABORTED") {
                    msg = `Request timed out after ${timeoutMs}ms. The server may be overloaded.`;
                } else if (err.response) {
                    msg = `Server returned ${err.response.status}: ${err.response.statusText}`;
                } else if (err.message) {
                    msg = `Error: ${err.message}`;
                }
                vscode.window.showErrorMessage(msg);
            }
        }
    );
}

function activate(context) {
    console.log('Extension "code-commenter" is now active.');
    const disposable = vscode.commands.registerCommand(COMMAND_ID, generateComment);
    context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = { activate, deactivate };
