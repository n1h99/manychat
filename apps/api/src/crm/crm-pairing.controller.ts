import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CompleteCrmPairingDto } from './dto';
import { CrmService } from './crm.service';

@ApiTags('crm pairing')
@Controller('integrations/v1/crm')
export class CrmPairingController {
  constructor(@Inject(CrmService) private readonly crm: CrmService) {}

  @Post('pair')
  @HttpCode(200)
  @ApiBody({ type: CompleteCrmPairingDto })
  @ApiOkResponse({ description: 'Pairing consumed and credentials returned once' })
  async pair(@Body() body: CompleteCrmPairingDto) {
    return this.crm.completePairing(body);
  }
}
