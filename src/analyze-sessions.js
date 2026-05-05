const fs = require('fs');
const readline = require('readline');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const OUTPUT_DIR = path.join(__dirname, '../output');
const SESSIONS_DIR = path.join(OUTPUT_DIR, 'sessions');
const COSTS_FILE = path.join(__dirname, 'costs.json');

async function processCopilotSessions() {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    
    let costsData;
    try {
        costsData = JSON.parse(fs.readFileSync(COSTS_FILE, 'utf8'));
    } catch (e) {
        console.error("❌ ERROR: Could not read costs.json. Please ensure it exists in the src folder.");
        process.exit(1);
    }

    // Helper function to stop execution if an unknown model is found
    function enforceKnownModel(modelName, fileName) {
        if (modelName && modelName !== 'unknown' && !costsData[modelName]) {
            console.error(`\n🚨 FATAL ERROR: Unknown model detected -> "${modelName}"`);
            console.error(`Found inside file: ${fileName}`);
            console.error(`\nTo fix this, open './src/costs.json' and add pricing for this model before running the analyzer again.`);
            console.error(`\nCopy/Paste this example into costs.json:\n  "${modelName}": { "costInput": 0.00, "costOutput": 0.00, "costInputCached": 0.00, "costWriteCached": 0.00 }\n`);
            process.exit(1);
        }
    }

    const dailyProjectMetrics = {};
    const sessionOverview = [];
    
    const files = fs.readdirSync(DATA_DIR).filter(file => file.endsWith('.jsonl'));
    if (files.length === 0) console.warn("⚠️ No .jsonl files found in ./data/");

    for (const fileName of files) {
        const filePath = path.join(DATA_DIR, fileName);
        let sessionData = {
            sessionId: path.basename(fileName, '.jsonl'),
            day: 'Unknown_Date', project: 'Unknown_Project', models: {}
        };
        
        let timeline = [];
        let currentModel = 'unknown';
        
        // Copilot CLI starts with ~8,000 tokens of System Prompt + Tool Definitions
        let runningContextTokens = 8000; 

        const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });

        for await (const line of rl) {
            if (!line.trim()) continue;
            try {
                const event = JSON.parse(line);
                
                // Track metadata
                if (event.type === 'session.start') {
                    if (event.data?.sessionId) sessionData.sessionId = event.data.sessionId;
                    if (event.data?.startTime) sessionData.day = event.data.startTime.split('T')[0];
                    if (event.data?.context?.repository) sessionData.project = event.data.context.repository;
                }
                if (event.type === 'session.model_change' && event.data?.newModel) {
                    currentModel = event.data.newModel;
                    enforceKnownModel(currentModel, fileName);
                }

                // 1. User Message (Adds to history)
                if (event.type === 'user.message') {
                    const userTokens = Math.ceil((event.data.content?.length || 0) / 4);
                    runningContextTokens += userTokens;
                    timeline.push({ type: 'user', content: event.data.content?.substring(0, 200) + '...' });
                }

                // 2. Tool Execution (Adds massive file contents to history)
                if (event.type === 'tool.execution_complete') {
                    if (event.data.model) enforceKnownModel(event.data.model, fileName);

                    const resultLen = event.data.toolTelemetry?.metrics?.resultForLlmLength || 0;
                    const toolTokens = Math.ceil(resultLen / 4); // Standard estimate: 4 chars per token
                    runningContextTokens += toolTokens;
                    timeline.push({ type: 'tool', success: event.data.success, model: event.data.model, addedTokens: toolTokens });
                }

                // 3. Context Compaction
                if (event.type === 'session.compaction_complete') {
                    runningContextTokens = 12000; // Reset running context estimate after a compaction
                    timeline.push({ type: 'compaction', droppedTokens: event.data.preCompactionTokens });
                }

                // 4. Assistant Message
                if (event.type === 'assistant.message') {
                    const outTokens = event.data.outputTokens || 0;
                    const inTokens = runningContextTokens; 
                    
                    runningContextTokens += outTokens; 
                    
                    const toolCount = event.data.toolRequests?.length || 0;
                    timeline.push({ 
                        type: 'assistant', model: currentModel, 
                        tokens: outTokens, inputTokens: inTokens, 
                        tools: toolCount, content: event.data.content?.substring(0, 200) || '(No text, tool execution)' 
                    });
                }

                // 5. Global Aggregation
                if (event.type === 'session.shutdown' && event.data?.modelMetrics) {
                    for (const [modelName, modelData] of Object.entries(event.data.modelMetrics)) {
                        enforceKnownModel(modelName, fileName);

                        if (!sessionData.models[modelName]) {
                            sessionData.models[modelName] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, requests: 0 };
                        }
                        const usage = modelData.usage || {};
                        sessionData.models[modelName].inputTokens += usage.inputTokens || 0;
                        sessionData.models[modelName].outputTokens += usage.outputTokens || 0;
                        sessionData.models[modelName].cacheReadTokens += usage.cacheReadTokens || 0;
                        sessionData.models[modelName].cacheWriteTokens += usage.cacheWriteTokens || 0;
                        sessionData.models[modelName].reasoningTokens += usage.reasoningTokens || 0;
                    }
                }
            } catch (err) { }
        }

        sessionOverview.push(sessionData);
        fs.writeFileSync(path.join(SESSIONS_DIR, `${sessionData.sessionId}.json`), JSON.stringify(timeline, null, 2));

        const { day, project } = sessionData;
        if (!dailyProjectMetrics[day]) dailyProjectMetrics[day] = {};
        if (!dailyProjectMetrics[day][project]) dailyProjectMetrics[day][project] = {};
        
        for (const [modelName, metrics] of Object.entries(sessionData.models)) {
            if (!dailyProjectMetrics[day][project][modelName]) {
                dailyProjectMetrics[day][project][modelName] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, requests: 0 };
            }
            const agg = dailyProjectMetrics[day][project][modelName];
            agg.inputTokens += metrics.inputTokens; agg.outputTokens += metrics.outputTokens;
            agg.cacheReadTokens += metrics.cacheReadTokens; agg.cacheWriteTokens += metrics.cacheWriteTokens;
        }
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, 'daily_project_metrics.json'), JSON.stringify(dailyProjectMetrics, null, 2));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'session_overview.json'), JSON.stringify(sessionOverview, null, 2));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'costs.json'), JSON.stringify(costsData, null, 2));

    console.log(`✅ Processed ${files.length} files. Session timelines generated.`);
}

processCopilotSessions();