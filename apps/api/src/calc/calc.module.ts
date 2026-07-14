import { Body, Controller, Module, Post, UseGuards } from '@nestjs/common';
import { calculateQuote, CalcInputSchema, type CalcInput } from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('calc')
@UseGuards(JwtAuthGuard)
export class CalcController {
  /** Previsualiza el cálculo sin guardar nada. */
  @Post()
  preview(@Body(new ZodValidationPipe(CalcInputSchema)) input: CalcInput) {
    return calculateQuote(input);
  }
}

@Module({
  controllers: [CalcController],
})
export class CalcModule {}
