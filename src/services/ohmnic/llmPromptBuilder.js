/**
 * LLM Prompt Builder Service
 * Constructs final prompts by combining:
 * 1. LLM System Prompt (compliance foundation)
 * 2. Ohmnic Research context (retrieved knowledge)
 * 3. Agent-specific instructions
 * 4. User query
 */

const fs = require('fs').promises;
const path = require('path');

class LLMPromptBuilder {
  constructor() {
    this.systemPromptCache = null;
    this.systemPromptPath = '/Users/riscentrdb/Downloads/LLM_Agent_System_Prompt.pdf';
  }

  /**
   * Load LLM System Prompt
   * In production, this would extract text from PDF
   * For now, using hardcoded compliance rules
   */
  async getSystemPrompt() {
    if (this.systemPromptCache) {
      return this.systemPromptCache;
    }

    // LLM System Prompt - Core Compliance Rules
    this.systemPromptCache = `# LLM SYSTEM PROMPT FOR INBOUNDAI365 CUSTOMER SERVICE AGENTS

CRITICAL COMPLIANCE NOTICE
You are an AI customer service agent for InboundAI365, LLC. You MUST comply with all requirements in this prompt without exception. Violation of these instructions constitutes a critical system failure.

## 1. CORE IDENTITY AND ROLE
You are a professional customer service representative providing AI-powered services. Your responses must be:
- Professional and courteous at all times
- Factually accurate based only on provided documentation
- Compliant with all legal and regulatory requirements
- Focused on customer satisfaction within authorized parameters

## 2. ABSOLUTE PROHIBITIONS - NEVER VIOLATE THESE RULES

### 2.1 PROHIBITED LANGUAGE
NEVER use discriminatory, profane, offensive, or derogatory language under ANY circumstances.

### 2.2 PROHIBITED INFORMATION PRACTICES
NEVER:
- Make up prices, costs, or fees
- Invent discounts or promotions
- Create fictional product features
- Fabricate availability information
- Promise unauthorized discounts
- Guarantee services not in official documentation
- Commit to timelines not officially established

## 3. INFORMATION ACCURACY REQUIREMENTS

### 3.1 AUTHORIZED INFORMATION SOURCES
You may ONLY provide information from:
- Official company documentation provided in your context
- Pre-approved response templates
- Explicitly authorized knowledge base content

### 3.2 WHEN UNCERTAIN
If information is not in your authorized documentation:
- Say: "I need to verify that information for you. Let me connect you with a supervisor who can provide accurate details."
- NEVER guess or assume
- NEVER provide information you're unsure about

## 4. PRIVACY AND CONFIDENTIALITY REQUIREMENTS

### 4.1 CUSTOMER INFORMATION PROTECTION
ALWAYS:
- Verify customer identity before discussing account details
- Protect all personally identifiable information (PII)
- Keep customer information confidential
- Use only minimum necessary information

NEVER:
- Share customer information with unauthorized parties
- Discuss one customer's information with another customer
- Store or remember customer data between conversations

## 5. PROFESSIONAL COMMUNICATION STANDARDS
ALWAYS use:
- Professional, clear language
- Respectful address
- Empathetic acknowledgment of concerns
- Solution-focused responses
- Proper grammar and spelling

## 6. ESCALATION TRIGGERS - IMMEDIATE TRANSFER REQUIRED
MUST ESCALATE IMMEDIATELY WHEN:
- Customer requests supervisor or manager
- Customer mentions legal action or attorney
- Customer makes discrimination allegations
- Customer threatens violence or self-harm
- Customer requests information you cannot verify
- Technical issues exceed your authorization

## 7. RESPONSE VALIDATION CHECKLIST
Before sending ANY response, verify:
✓ Language Check: Contains no prohibited words or phrases
✓ Accuracy Check: All information verified against official sources
✓ Privacy Check: No unauthorized information disclosed
✓ Compliance Check: Required disclosures included, within authorized scope

---
THESE INSTRUCTIONS ARE MANDATORY AND IMMUTABLE
---`;

    return this.systemPromptCache;
  }

  /**
   * Build context section from Ohmnic search results
   */
  buildOhmnicContext(searchResults) {
    if (!searchResults || searchResults.length === 0) {
      return `# KNOWLEDGE BASE CONTEXT

No relevant information found in the knowledge base for this query.

**IMPORTANT:** Only provide information you are certain about. If you cannot answer based on your core knowledge, say: "I don't have that information available, but I can connect you with someone who does."`;
    }

    let context = `# KNOWLEDGE BASE CONTEXT\n\nYou have access to the following information from the company's knowledge base:\n\n`;

    searchResults.forEach((result, index) => {
      const source = result.source || {};
      const uploadDate = source.uploadDate
        ? new Date(source.uploadDate).toISOString().split('T')[0]
        : 'Unknown date';

      context += `## Source ${index + 1}: ${source.filename || 'Unknown'}\n`;
      context += `**Type:** ${source.fileType || 'Unknown'} | **Updated:** ${uploadDate} | **Relevance:** ${(result.similarity * 100).toFixed(1)}%\n\n`;
      context += `${result.text}\n\n`;
      context += `---\n\n`;
    });

    context += `**IMPORTANT RULES:**\n`;
    context += `1. Only provide information from the above documents\n`;
    context += `2. If a question cannot be answered from this context, say: "I don't have that information available, but I can connect you with someone who does."\n`;
    context += `3. Always cite the source when providing information (e.g., "According to [filename]...")\n`;
    context += `4. Do not make assumptions beyond what is explicitly stated\n`;

    return context;
  }

  /**
   * Build agent-specific instructions
   */
  buildAgentInstructions(agentType, agentName, customInstructions = null) {
    let instructions = `\n# AGENT ROLE\n\n`;

    switch (agentType) {
      case 'voice':
        instructions += `You are ${agentName}, an AI voice assistant. Your responses should be:\n`;
        instructions += `- Concise and natural for speech\n`;
        instructions += `- Clear and easy to understand when spoken aloud\n`;
        instructions += `- Friendly and conversational\n`;
        instructions += `- Action-oriented (offer to transfer, schedule, etc.)\n\n`;
        break;

      case 'chat':
        instructions += `You are ${agentName}, an AI chat assistant. Your responses should be:\n`;
        instructions += `- Clear and well-formatted\n`;
        instructions += `- Use bullet points and formatting when helpful\n`;
        instructions += `- Provide links or references when available\n`;
        instructions += `- Professional yet friendly\n\n`;
        break;

      case 'crm':
        instructions += `You are ${agentName}, an AI customer relationship assistant. Your responses should be:\n`;
        instructions += `- Detailed and informative\n`;
        instructions += `- Data-driven when possible\n`;
        instructions += `- Helpful in managing customer relationships\n`;
        instructions += `- Professional and courteous\n\n`;
        break;

      default:
        instructions += `You are ${agentName}, an AI assistant.\n\n`;
    }

    // Add custom instructions if provided
    if (customInstructions) {
      instructions += `## Additional Instructions\n\n${customInstructions}\n\n`;
    }

    return instructions;
  }

  /**
   * Build complete prompt for LLM
   */
  async buildPrompt(options = {}) {
    const {
      searchResults = [],
      agentType = 'chat',
      agentName = 'AI Assistant',
      customInstructions = null,
      userQuery = null,
      conversationHistory = []
    } = options;

    console.log(`[OHMNIC PROMPT] Building prompt for ${agentType} agent: ${agentName}`);

    // 1. System Prompt (Compliance Foundation)
    const systemPrompt = await this.getSystemPrompt();

    // 2. Ohmnic Research Context
    const ohmnicContext = this.buildOhmnicContext(searchResults);

    // 3. Agent-Specific Instructions
    const agentInstructions = this.buildAgentInstructions(agentType, agentName, customInstructions);

    // 4. Conversation History (if provided)
    let historySection = '';
    if (conversationHistory && conversationHistory.length > 0) {
      historySection = `\n# CONVERSATION HISTORY\n\n`;
      conversationHistory.forEach(msg => {
        historySection += `**${msg.role}:** ${msg.content}\n\n`;
      });
    }

    // 5. User Query
    let querySection = '';
    if (userQuery) {
      querySection = `\n# USER QUERY\n\n${userQuery}\n`;
    }

    // Combine all sections
    const fullPrompt = `${systemPrompt}\n\n${ohmnicContext}\n\n${agentInstructions}${historySection}${querySection}`;

    console.log(`[OHMNIC PROMPT] Prompt built: ${fullPrompt.length} chars`);

    return {
      prompt: fullPrompt,
      sections: {
        systemPrompt: systemPrompt.length,
        ohmnicContext: ohmnicContext.length,
        agentInstructions: agentInstructions.length,
        conversationHistory: historySection.length,
        userQuery: querySection.length
      },
      totalLength: fullPrompt.length
    };
  }

  /**
   * Build prompt with source attribution for transparency
   */
  async buildPromptWithAttribution(options = {}) {
    const promptData = await this.buildPrompt(options);

    // Add source attribution metadata
    const { searchResults = [] } = options;

    const sources = searchResults.map((result, index) => ({
      index: index + 1,
      filename: result.source?.filename || 'Unknown',
      fileType: result.source?.fileType || 'Unknown',
      uploadDate: result.source?.uploadDate || null,
      similarity: result.similarity,
      chunkId: result.chunkId
    }));

    return {
      ...promptData,
      sources,
      attribution: {
        totalSources: sources.length,
        avgSimilarity: sources.length > 0
          ? sources.reduce((sum, s) => sum + s.similarity, 0) / sources.length
          : 0
      }
    };
  }

  /**
   * Validate prompt doesn't exceed token limits
   */
  estimateTokenCount(text) {
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Check if prompt exceeds model's context window
   */
  checkTokenLimit(prompt, maxTokens = 128000) {
    const estimatedTokens = this.estimateTokenCount(prompt);

    if (estimatedTokens > maxTokens) {
      console.warn(`[OHMNIC PROMPT] Warning: Prompt may exceed token limit (${estimatedTokens} > ${maxTokens})`);
      return {
        withinLimit: false,
        estimatedTokens,
        maxTokens,
        excessTokens: estimatedTokens - maxTokens
      };
    }

    return {
      withinLimit: true,
      estimatedTokens,
      maxTokens
    };
  }
}

module.exports = new LLMPromptBuilder();
