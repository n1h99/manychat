import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';

@Module({
  controllers: [ContactsController],
  exports: [ContactsService],
  imports: [AccessModule, AuditModule, JwtModule.register({})],
  providers: [ContactsService],
})
export class ContactsModule {}
