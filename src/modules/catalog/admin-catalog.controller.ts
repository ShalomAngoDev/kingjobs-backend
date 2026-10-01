import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CatalogService } from './catalog.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateRequirementDto } from './dto/update-requirement.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@ApiTags('admin-catalog')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller({ path: 'admin', version: '1' })
export class AdminCatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post('service-categories')
  @ApiOperation({ summary: 'Créer une catégorie' })
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.catalogService.createCategory(dto);
  }

  @Patch('service-categories/:id')
  @ApiOperation({ summary: 'Modifier / désactiver une catégorie' })
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.catalogService.updateCategory(id, dto);
  }

  @Post('services')
  @ApiOperation({ summary: 'Créer un service' })
  createService(@Body() dto: CreateServiceDto) {
    return this.catalogService.createService(dto);
  }

  @Patch('services/:id')
  @ApiOperation({ summary: 'Modifier / désactiver un service' })
  updateService(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.catalogService.updateService(id, dto);
  }

  @Post('services/:id/requirements')
  @ApiOperation({ summary: 'Ajouter une exigence à un service' })
  createRequirement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRequirementDto,
  ) {
    return this.catalogService.createRequirement(id, dto);
  }

  @Patch('service-requirements/:id')
  @ApiOperation({ summary: 'Modifier / désactiver une exigence' })
  updateRequirement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRequirementDto,
  ) {
    return this.catalogService.updateRequirement(id, dto);
  }
}
