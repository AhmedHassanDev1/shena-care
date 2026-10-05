const fs = require('fs');
let code = fs.readFileSync('apps/api/src/modules/guidance/services/guidance.service.ts', 'utf8');

// Update imports
code = code.replace(
  "import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';",
  "import { Injectable, NotFoundException, BadRequestException, Logger, ServiceUnavailableException, BadGatewayException, InternalServerErrorException } from '@nestjs/common';"
);
code = code.replace(
  "import { AiClient } from '../../../platform/ai';",
  "import { AiClient, AiClientError, AiErrorKind } from '../../../platform/ai';"
);

// Update recommendRoutine logic
const target = `    let result;
    try {
      result = await this.aiClient.recommendRoutine(recommendationInput, sessionId);
    } catch (err) {
      // Return a system fallback message if AI is down
      const fallbackMsg = await this.prisma.guidanceMessage.create({
        data: {
          sessionId: session.id,
          role: GuidanceMessageRole.system,
          content: 'Sorry, I am currently unavailable to provide recommendations.',
        },
      });
      return fallbackMsg;
    }`;

const replacement = `    let result;
    try {
      result = await this.aiClient.recommendRoutine(recommendationInput, sessionId);
    } catch (err) {
      if (err instanceof AiClientError) {
        if (err.kind === AiErrorKind.UNAVAILABLE || err.kind === AiErrorKind.TIMEOUT) {
          throw new ServiceUnavailableException({
            message: 'AI recommendation service is temporarily unavailable. Please try again.',
            reason: err.kind,
            retryable: true,
          });
        }
        if (err.kind === AiErrorKind.INVALID_RESPONSE || err.kind === AiErrorKind.INCOMPATIBLE_SCHEMA) {
          this.logger.error(\`AI response malformed: \${err.message}\`);
          throw new BadGatewayException({
            message: 'AI recommendation service returned an invalid response.',
            reason: err.kind,
            retryable: false,
          });
        }
      }
      this.logger.error(\`Unknown AI error: \${err}\`);
      throw new InternalServerErrorException('Failed to process AI recommendation.');
    }`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('apps/api/src/modules/guidance/services/guidance.service.ts', code);
  console.log("Updated guidance.service.ts successfully!");
} else {
  console.log("Target not found in guidance.service.ts");
}
