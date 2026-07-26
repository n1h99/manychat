import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AccessModule } from '../access/access.module';
import { AuditModule } from '../audit/audit.module';
import { ProjectRolesService } from './project-roles.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [MembersController, ProjectsController],
  exports: [ProjectRolesService, ProjectsService],
  imports: [AccessModule, AuditModule, JwtModule.register({})],
  providers: [MembersService, ProjectRolesService, ProjectsService],
})
export class ProjectsModule {}
